// Servidor local do conversor: entrega o site e, com yt-dlp + ffmpeg instalados,
// extrai o áudio de links (YouTube, Instagram, TikTok, SoundCloud...).
// Uso: node servidor.js [porta]
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PASTA = __dirname;
const PORTA = Number(process.argv[2] || 8075);
const HOSTS = [`localhost:${PORTA}`, `127.0.0.1:${PORTA}`];
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};
const FORMATOS = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav' };

// Procura no PATH e nas pastas do winget (o PATH só é atualizado em janelas abertas depois da instalação)
function acharPrograma(nome) {
  const exe = process.platform === 'win32' ? nome + '.exe' : nome;
  const pastas = (process.env.PATH || '').split(path.delimiter);
  if (process.env.LOCALAPPDATA) {
    const winget = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet');
    pastas.push(path.join(winget, 'Links'));
    const pacotes = path.join(winget, 'Packages');
    if (fs.existsSync(pacotes)) {
      for (const pacote of fs.readdirSync(pacotes)) {
        const raiz = path.join(pacotes, pacote);
        pastas.push(raiz);
        // ffmpeg fica em <pacote>/<versao>/bin
        try {
          for (const sub of fs.readdirSync(raiz)) pastas.push(path.join(raiz, sub, 'bin'));
        } catch {}
      }
    }
  }
  for (const p of pastas) {
    if (p && fs.existsSync(path.join(p, exe))) return path.join(p, exe);
  }
  return null;
}

function json(res, status, dados) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(dados));
}

function mensagemDeErro(log) {
  const linha = log.split(/\r?\n/).reverse().find(l => l.startsWith('ERROR:'));
  if (!linha) return 'Não foi possível extrair o áudio desse link.';
  if (/DRM/i.test(linha)) return 'Esse conteúdo tem proteção (DRM) e não pode ser baixado.';
  if (/Unsupported URL/i.test(linha)) return 'Esse site não é suportado.';
  return 'Não foi possível extrair: ' + linha.replace(/^ERROR:\s*/, '');
}

function extrair(req, res, params) {
  const ytdlp = acharPrograma('yt-dlp');
  const ffmpeg = acharPrograma('ffmpeg');
  if (!ytdlp || !ffmpeg) return json(res, 500, { erro: 'yt-dlp ou ffmpeg não está instalado neste computador.' });

  let url;
  try { url = new URL(params.get('url')); } catch { return json(res, 400, { erro: 'Link inválido.' }); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return json(res, 400, { erro: 'O link precisa começar com http:// ou https://' });
  const formato = FORMATOS[params.get('formato')] ? params.get('formato') : 'mp3';

  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'conversor-'));
  const limpar = () => fs.rm(pasta, { recursive: true, force: true }, () => {});
  const args = [
    '--no-playlist', '--no-progress', '--extract-audio',
    '--audio-format', formato, '--audio-quality', '0',
    '--ffmpeg-location', path.dirname(ffmpeg),
    '-o', path.join(pasta, '%(title).150B.%(ext)s'),
    '--', url.href,  // "--" impede que o link seja lido como opção
  ];
  console.log(`Extraindo áudio (${formato}) de ${url.href}`);
  const proc = spawn(ytdlp, args, { windowsHide: true });
  let log = '';
  proc.stdout.on('data', d => { log += d; });
  proc.stderr.on('data', d => { log += d; });
  // se a página for fechada no meio, para o download
  res.on('close', () => { if (proc.exitCode === null) proc.kill(); });

  proc.on('close', codigo => {
    if (res.destroyed) return limpar();
    const arquivo = fs.existsSync(pasta) && fs.readdirSync(pasta).find(f => f.endsWith('.' + formato));
    if (codigo !== 0 || !arquivo) {
      limpar();
      console.log(log.trim().split(/\r?\n/).slice(-3).join('\n'));
      return json(res, 500, { erro: mensagemDeErro(log) });
    }
    const caminho = path.join(pasta, arquivo);
    console.log(`Pronto: ${arquivo}`);
    res.writeHead(200, {
      'Content-Type': FORMATOS[formato],
      'Content-Length': fs.statSync(caminho).size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(arquivo)}`,
    });
    fs.createReadStream(caminho).on('close', limpar).pipe(res);
  });
}

http.createServer((req, res) => {
  // só aceita a própria página: bloqueia outros sites tentando usar o servidor
  if (!HOSTS.includes(req.headers.host) || (req.headers.origin && !HOSTS.some(h => req.headers.origin === 'http://' + h))) {
    res.writeHead(403);
    return res.end();
  }
  const { pathname, searchParams } = new URL(req.url, 'http://' + req.headers.host);
  if (pathname === '/api/status') {
    return json(res, 200, { local: true, ytdlp: !!acharPrograma('yt-dlp'), ffmpeg: !!acharPrograma('ffmpeg') });
  }
  if (pathname === '/api/extrair') return extrair(req, res, searchParams);

  const nome = decodeURIComponent(pathname);
  const arquivo = path.join(PASTA, nome === '/' ? 'index.html' : nome);
  const valido = arquivo.startsWith(PASTA + path.sep) && !nome.split('/').some(p => p.startsWith('.'));
  if (!valido || !fs.existsSync(arquivo) || !fs.statSync(arquivo).isFile()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream' });
  fs.createReadStream(arquivo).pipe(res);
}).listen(PORTA, '127.0.0.1', () => console.log(`Servidor em http://localhost:${PORTA}`));
