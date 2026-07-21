const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'dist');
const port = Number(process.env.PORT || 8090);
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

http.createServer((request, response) => {
  const pathname = decodeURIComponent((request.url || '/').split('?')[0]);
  let filePath = path.resolve(root, pathname.replace(/^[/\\]+/, '') || 'index.html');
  if (!filePath.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  if (!fs.existsSync(filePath) && fs.existsSync(`${filePath}.html`)) filePath = `${filePath}.html`;
  if (!fs.existsSync(filePath)) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.setHeader('Content-Type', contentTypes[path.extname(filePath)] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(response);
}).listen(port, '0.0.0.0', () => {
  console.log(`MetricRally web export: http://localhost:${port}`);
});
