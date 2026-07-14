/**
 * BRC - Backend de Storage (referência)
 * ----------------------------------------------------
 * Implementa a API que o painel HTML (BRC - Colheita e Comercialização) espera:
 *
 *   GET    /api/storage?prefix=xxx   -> { keys: [...] }
 *   GET    /api/storage/:key         -> { value }         (404 se não existir)
 *   PUT    /api/storage/:key         -> { value }          body: { value }
 *   DELETE /api/storage/:key         -> { deleted: true }  (404 se não existir)
 *
 * Autenticação: header  x-api-key: <API_KEY>
 *
 * Não usa NENHUMA dependência externa (só módulos nativos do Node.js).
 * Isso significa que basta ter o Node.js instalado e rodar:
 *
 *     node server.js
 *
 * Os dados são gravados no arquivo data.json, na mesma pasta deste servidor.
 * Configure a porta e a chave de API por variável de ambiente (veja .env.example).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- Configuração ----------
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';
const DATA_FILE = path.join(__dirname, 'data.json');

if (!API_KEY) {
  console.warn('\n⚠️  ATENÇÃO: nenhuma API_KEY definida. Configure a variável de ambiente API_KEY antes de usar em produção!\n');
}

// ---------- "Banco de dados" simples em arquivo JSON ----------
function loadDB() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {}; // arquivo ainda não existe ou está vazio
  }
}

function saveDB(db) {
  // grava em arquivo temporário e renomeia, para evitar corromper o arquivo
  // se o processo for interrompido no meio da escrita
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

let db = loadDB();

// ---------- Utilidades HTTP ----------
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10 * 1024 * 1024) { // limite de 10MB por segurança
        reject(new Error('payload muito grande'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function checkAuth(req) {
  if (!API_KEY) return true; // se não configurou chave, libera (não recomendado em produção)
  const key = req.headers['x-api-key'];
  if (!key || key.length !== API_KEY.length) return false;
  // comparação em tempo constante, para evitar timing attacks
  return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(API_KEY));
}

// ---------- Servidor ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Pre-flight CORS
    if (req.method === 'OPTIONS') {
      return send(res, 204, {});
    }

    // Só atende rotas dentro de /api/storage
    if (!url.pathname.startsWith('/api/storage')) {
      return send(res, 404, { error: 'rota não encontrada' });
    }

    if (!checkAuth(req)) {
      return send(res, 401, { error: 'chave de API inválida ou ausente (header x-api-key)' });
    }

    const rest = url.pathname.replace(/^\/api\/storage\/?/, ''); // parte depois de /api/storage/
    const key = rest ? decodeURIComponent(rest) : null;

    // GET /api/storage?prefix=xxx  -> listar chaves
    if (req.method === 'GET' && !key) {
      const prefix = url.searchParams.get('prefix') || '';
      const keys = Object.keys(db).filter((k) => k.startsWith(prefix));
      return send(res, 200, { keys });
    }

    // GET /api/storage/:key -> ler valor
    if (req.method === 'GET' && key) {
      if (!(key in db)) return send(res, 404, { error: 'não encontrado' });
      return send(res, 200, { value: db[key].value });
    }

    // PUT /api/storage/:key -> gravar valor
    if (req.method === 'PUT' && key) {
      const raw = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return send(res, 400, { error: 'corpo da requisição precisa ser JSON válido' });
      }
      db[key] = { value: parsed.value, updatedAt: new Date().toISOString() };
      saveDB(db);
      return send(res, 200, { value: db[key].value });
    }

    // DELETE /api/storage/:key -> apagar valor
    if (req.method === 'DELETE' && key) {
      if (!(key in db)) return send(res, 404, { error: 'não encontrado' });
      delete db[key];
      saveDB(db);
      return send(res, 200, { deleted: true });
    }

    return send(res, 405, { error: 'método não suportado' });
  } catch (err) {
    console.error('Erro inesperado:', err);
    return send(res, 500, { error: 'erro interno no servidor' });
  }
});

server.listen(PORT, () => {
  console.log(`\n✅ Servidor BRC rodando em http://localhost:${PORT}`);
  console.log(`   Rotas disponíveis em: http://localhost:${PORT}/api/storage`);
  console.log(`   Dados salvos em: ${DATA_FILE}\n`);
});
