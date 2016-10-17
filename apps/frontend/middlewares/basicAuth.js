"use strict";
const basicAuth = require('basic-auth');
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = (req, res, next) => {
    if (process.env.NODE_ENV === 'prod')
        return next();
    if (process.env.NODE_ENV === 'prod02')
        return next();
    if (req.originalUrl === '/GMO/reserve/notify')
        return next(); // GMO結果通知に対してはオープンにする
    let user = basicAuth(req);
    if (user && user['name'] === 'motionpicture' && user['pass'] === '4_CS/T|YG*Lz')
        return next();
    res.statusCode = 401;
    res.setHeader('WWW-Authenticate', 'Basic realm="TIFF Authentication"');
    res.end('Unauthorized');
};