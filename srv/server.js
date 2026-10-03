const cds = require('@sap/cds');

cds.on('bootstrap', (app) => {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin);
    }
    res.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Custom-Header, x-csrf-token');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Access-Control-Expose-Headers', 'set-cookie, x-csrf-token');
    if (req.method === 'OPTIONS') {
      return res.status(204).send();
    }
    next();
  });
});

module.exports = cds.server;
