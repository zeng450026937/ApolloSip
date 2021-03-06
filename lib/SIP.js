const adapter = require('webrtc-adapter');
const pkg = require('../package.json');
const C = require('./Constants');
const Exceptions = require('./Exceptions');
const Utils = require('./Utils');
const UA = require('./UA');
const URI = require('./URI');
const NameAddrHeader = require('./NameAddrHeader');
const Grammar = require('./Grammar');
const SocketIOInterface = require('./SocketIOInterface');
const WebSocketInterface = require('./WebSocketInterface');
const debug = require('debug')('SIP');

debug('version %s', pkg.version);

/**
 * Expose the SIP module.
 */
module.exports = {
  C,
  Exceptions,
  Utils,
  UA,
  URI,
  NameAddrHeader,
  SocketIOInterface,
  WebSocketInterface,
  Grammar,
  // Expose the debug module.
  debug : require('debug'),
  // Expose the adapter module.
  adapter,
  get name() { return pkg.title; },
  get version() { return pkg.version; }
};
