const morgan = require('morgan');

const requestLogger = morgan('[:date[iso]] :method :url :status :res[content-length] - :response-time ms');

module.exports = requestLogger;
