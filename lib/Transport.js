const Socket = require('./Socket');
const debug = require('debug')('SIP:Transport');
const debugerror = require('debug')('SIP:ERROR:Transport');

debugerror.log = console.warn.bind(console);

/**
 * Constants
 */
const C = {
  // Transport status.
  STATUS_CONNECTED    : 0,
  STATUS_CONNECTING   : 1,
  STATUS_DISCONNECTED : 2,

  // Socket status.
  SOCKET_STATUS_READY : 0,
  SOCKET_STATUS_ERROR : 1,

  // Recovery options.
  recovery_options : {
    min_interval : 2, // minimum interval in seconds between recover attempts
    max_interval : 30 // maximum interval in seconds between recover attempts
  }
};

/*
 * Manages one or multiple SIP.Socket instances.
 * Is reponsible for transport recovery logic among all socket instances.
 *
 * @socket SIP::Socket instance
 */
module.exports = class Transport
{
  constructor(sockets, recovery_options = C.recovery_options)
  {
    debug('new()');

    this.status = C.STATUS_DISCONNECTED;

    // Current socket.
    this.socket = null;

    // Socket collection.
    this.sockets = [];

    this.recovery_options = recovery_options;
    this.recover_attempts = 0;
    this.recovery_timer = null;

    this._keepAliveInterval = 5;
    this._keepAliveTimer = null;
    this._keepAliveTimeout = null;

    this.close_requested = false;

    if (typeof sockets === 'undefined')
    {
      throw new TypeError('Invalid argument.' +
                          ' undefined \'sockets\' argument');
    }

    this._setSocket(sockets);
    // Get the socket with higher weight.
    this._getSocket();
  }

  /**
   * Instance Methods
   */

  get via_transport()
  {
    return this.socket.via_transport;
  }

  get url()
  {
    return this.socket.url;
  }

  get sip_uri()
  {
    return this.socket.sip_uri;
  }

  connect()
  {
    debug('connect()');

    if (this.isConnected())
    {
      debug('Transport is already connected');

      return;
    }
    else if (this.isConnecting())
    {
      debug('Transport is connecting');

      return;
    }

    this.close_requested = false;
    this.status = C.STATUS_CONNECTING;
    this.onconnecting({ socket: this.socket, attempts: this.recover_attempts });

    if (!this.close_requested)
    {
      // Bind socket event callbacks.
      this.socket.onconnect = this._onConnect.bind(this);
      this.socket.ondisconnect = this._onDisconnect.bind(this);
      this.socket.ondata = this._onData.bind(this);

      this.socket.connect();
    }

    return;
  }

  disconnect()
  {
    debug('close()');

    this.close_requested = true;
    this.recover_attempts = 0;
    this.status = C.STATUS_DISCONNECTED;

    // Clear recovery_timer.
    if (this.recovery_timer !== null)
    {
      clearTimeout(this.recovery_timer);
      this.recovery_timer = null;
    }

    // Clear keep alive timer.
    this._stopSendingKeepAlives();

    // Unbind socket event callbacks.
    this.socket.onconnect = () => {};
    this.socket.ondisconnect = () => {};
    this.socket.ondata = () => {};

    this.socket.disconnect();
    this.ondisconnect();
  }

  send(data)
  {
    debug('send()');

    if (!this.isConnected())
    {
      debugerror('unable to send message, transport is not connected');

      return false;
    }

    const message = data.toString();

    if (message === '\r\n\r\n')
    {
      debug('sending keep alive message');
    }
    else
    {
      debug(`sending message:\n\n${message}\n`);
    }

    return this.socket.send(message);
  }

  isConnected()
  {
    return this.status === C.STATUS_CONNECTED;
  }

  isConnecting()
  {
    return this.status === C.STATUS_CONNECTING;
  }

  /**
   * Private API.
   */

  _reconnect()
  {
    this.recover_attempts+=1;

    let k = Math.floor((Math.random() * Math.pow(2, this.recover_attempts)) +1);

    if (k < this.recovery_options.min_interval)
    {
      k = this.recovery_options.min_interval;
    }

    else if (k > this.recovery_options.max_interval)
    {
      k = this.recovery_options.max_interval;
    }

    debug(`reconnection attempt: ${this.recover_attempts}. next connection attempt in ${k} seconds`);

    this.recovery_timer = setTimeout(() =>
    {
      if (!this.close_requested && !(this.isConnected() || this.isConnecting()))
      {
        // Get the next available socket with higher weight.
        this._getSocket();

        // Connect the socket.
        this.connect();
      }
    }, k * 1000);
  }

  _setSocket(sockets)
  {
    if (!(sockets instanceof Array))
    {
      sockets = [ sockets ];
    }

    sockets.forEach(function(socket)
    {
      if (!Socket.isSocket(socket.socket))
      {
        throw new TypeError('Invalid argument.' +
                            ' invalid \'SIP.Socket\' instance');
      }

      if (socket.weight && !Number(socket.weight))
      {
        throw new TypeError('Invalid argument.' +
                            ' \'weight\' attribute is not a number');
      }

      this.sockets.push({
        socket : socket.socket,
        weight : socket.weight || 0,
        status : C.SOCKET_STATUS_READY
      });
    }, this);
  }

  /**
   * get the next available socket with higher weight
   */
  _getSocket()
  {

    let candidates = [];

    this.sockets.forEach((socket) =>
    {
      if (socket.status === C.SOCKET_STATUS_ERROR)
      {
        return; // continue the array iteration
      }
      else if (candidates.length === 0)
      {
        candidates.push(socket);
      }
      else if (socket.weight > candidates[0].weight)
      {
        candidates = [ socket ];
      }
      else if (socket.weight === candidates[0].weight)
      {
        candidates.push(socket);
      }
    });

    if (candidates.length === 0)
    {
      // All sockets have failed. reset sockets status.
      this.sockets.forEach((socket) =>
      {
        socket.status = C.SOCKET_STATUS_READY;
      });

      // Get next available socket.
      this._getSocket();

      return;
    }

    const idx = Math.floor((Math.random()* candidates.length));

    this.socket = candidates[idx].socket;
  }

  /**
   * Socket Event Handlers
   */

  _onConnect()
  {
    this.recover_attempts = 0;
    this.status = C.STATUS_CONNECTED;

    // Clear recovery_timer.
    if (this.recovery_timer !== null)
    {
      clearTimeout(this.recovery_timer);
      this.recovery_timer = null;
    }

    this._startSendingKeepAlives();

    this.onconnect({ socket: this });
  }

  _onDisconnect(error, code, reason)
  {
    this.status = C.STATUS_DISCONNECTED;

    this._stopSendingKeepAlives();

    this.ondisconnect({
      socket : this.socket,
      error,
      code,
      reason
    });

    if (this.close_requested)
    {
      return;
    }

    // Update socket status.
    else
    {
      this.sockets.forEach(function(socket)
      {
        if (this.socket === socket.socket)
        {
          socket.status = C.SOCKET_STATUS_ERROR;
        }
      }, this);
    }

    this._reconnect(error);
  }

  _onData(data)
  {
    // CRLF Keep Alive response from server. Ignore it.
    if (data === '\r\n')
    {
      debug('received message with CRLF Keep Alive response');

      clearTimeout(this._keepAliveTimeout);
      this._keepAliveTimeout = null;

      return;
    }

    // Binary message.
    else if (typeof data !== 'string')
    {
      try
      {
        data = String.fromCharCode.apply(null, new Uint8Array(data));
      }
      catch (evt)
      {
        debug('received binary message failed to be converted into string,' +
              ' message discarded');

        return;
      }

      debug(`received binary message:\n\n${data}\n`);
    }

    // Text message.
    else
    {
      debug(`received text message:\n\n${data}\n`);
    }

    this.ondata({ transport: this, message: data });
  }

  _startSendingKeepAlives() 
  {
    if (this._keepAliveInterval && !this._keepAliveTimer) 
    {
      this._keepAliveTimer = setTimeout(() =>
      {
        this._sendKeepAlive();
        this._keepAliveTimer = null;
        this._startSendingKeepAlives();
      }, this._computeKeepAliveTimeout(this._keepAliveInterval));
    }
  }

  _stopSendingKeepAlives() 
  {
    if (this._keepAliveTimer)
    {
      clearTimeout(this._keepAliveTimer);
      this._keepAliveTimer = null;
    }
    if (this._keepAliveTimeout)
    {
      clearTimeout(this._keepAliveTimeout);
      this._keepAliveTimeout = null;
    }
  }

  _sendKeepAlive() 
  {
    if (this._keepAliveTimeout) { return; }

    this._keepAliveTimeout = setTimeout(() =>
    {
      this._keepAliveTimeout = null;
      debugerror('keepAliveTimeout');
    }, 10000);

    return this.send('\r\n\r\n');
  }

  _computeKeepAliveTimeout(upperBound) 
  {
    const lowerBound = upperBound * 0.8;

    return 1000 * ((Math.random() * (upperBound - lowerBound)) + lowerBound);
  }
};
