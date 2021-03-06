const SIP = require('../Base/SIP');
const Utils = require('../Base/Utils');
const URL = require('url');
const Base64 = require('js-base64').Base64;
const SocketInterface = require('../Socket/SocketInterface');
const ApolloControl = require('./ApolloControl');
const ApolloProvision = require('./ApolloProvision');
const debug = SIP.debug('Apollo:UA');

module.exports = class UA extends SIP.UA 
{
  constructor(configuration) 
  {
    const _sockets = [];

    if (!Array.isArray(configuration.servers)) 
    {
      configuration.servers = [ configuration.servers ];
    }

    for (const s of configuration.servers)
    {
      let url = s;

      if (Object.prototype.hasOwnProperty.call(s, 'url'))
      {
        url = s.url;

        const socket = SocketInterface.Create({
          server        : url,
          socketOptions : configuration.socketOptions,
          proxy         : configuration.proxy
        });

        _sockets.push({ socket: socket, weight: s.weight });
      }
      else
      {
        const socket = SocketInterface.Create({
          server        : url,
          socketOptions : configuration.socketOptions,
          proxy         : configuration.proxy
        });

        _sockets.push({ socket: socket });
      }
    }

    configuration.sockets = _sockets;

    super(configuration);

    Object.assign(this._configuration, {
      // common config
      servers              : undefined,
      proxy                : undefined,
      socketOptions        : undefined,
      debug                : false,
      // peer connection config
      iceServers           : undefined, // [ { urls: 'stun:stun.l.google.com:19302' } ]
      iceTransportPolicy   : 'all', // all | relay
      iceCandidatePoolSize : 0,
      // rtc config
      DtlsSrtpKeyAgreement : true,
      googIPv6             : false,
      // rtc offer/answer config
      // the number of audio streams to receive when creating an offer.
      offerToReceiveAudio  : true,
      // the number of video streams to receive when creating an offer.
      offerToReceiveVideo  : true,
      // call config
      anonymous            : false,
      // apollo service config
      conferenceFactoryUri : undefined,
      capabilities         : undefined,
      negotiateUrl         : undefined,
      phonebookUrl         : undefined,
      autopUrl             : undefined,
      endpointConfig       : undefined,
      serverConfig         : undefined
    });

    const optional = [
      'servers',
      'proxy',
      'socketOptions',
      'debug',
      'iceServers',
      'iceTransportPolicy',
      'iceCandidatePoolSize',
      'DtlsSrtpKeyAgreement',
      'googIPv6',
      'offerToReceiveAudio',
      'offerToReceiveVideo',
      'anonymous'
    ];

    for (const parameter of optional) 
    {
      if (configuration.hasOwnProperty(parameter)) 
      {
        const value = configuration[parameter];

        if (SIP.Utils.isEmpty(value)) 
        {
          continue;
        }

        this._configuration[parameter] = value;
      }
    }

    if (this._configuration.debug) 
    {
      SIP.debug.enable('SIP:* Apollo:*');
    }

    this._apolloControl = null;
    this._apolloProvision = null;
  }

  get(parameter) 
  {
    switch (parameter) 
    {
      case 'iceServers':
        return this._configuration.iceServers;

      case 'iceTransportPolicy':
        return this._configuration.iceTransportPolicy;

      case 'iceCandidatePoolSize':
        return this._configuration.iceCandidatePoolSize;

      case 'DtlsSrtpKeyAgreement':
        return this._configuration.DtlsSrtpKeyAgreement;

      case 'googIPv6':
        return this._configuration.googIPv6;

      case 'offerToReceiveAudio':
        return this._configuration.offerToReceiveAudio;

      case 'offerToReceiveVideo':
        return this._configuration.offerToReceiveVideo;

      case 'conferenceFactoryUri':
        return this._configuration.conferenceFactoryUri;

      case 'capabilities':
        return this._configuration.capabilities;

      case 'negotiateUrl':
        return this._configuration.negotiateUrl;

      case 'phonebookUrl':
        return this._configuration.phonebookUrl;
      
      case 'autopUrl':
        return this._configuration.autopUrl;

      case 'anonymous':
        return this._configuration.anonymous;

      case 'uri':
        return this._configuration.uri;

      default:
        return super.get(parameter);
    }
  }

  set(parameter, value) 
  {
    switch (parameter) 
    {
      case 'iceServers':
        this._configuration.iceServers = value;
        break;

      case 'iceTransportPolicy':
        this._configuration.iceTransportPolicy = value;
        break;

      case 'iceCandidatePoolSize':
        this._configuration.iceCandidatePoolSize = value;
        break;

      case 'DtlsSrtpKeyAgreement':
        this._configuration.DtlsSrtpKeyAgreement = value;
        break;

      case 'googIPv6':
        this._configuration.googIPv6 = value;
        break;

      case 'offerToReceiveAudio':
        this._configuration.offerToReceiveAudio = value;
        break;

      case 'offerToReceiveVideo':
        this._configuration.offerToReceiveVideo = value;
        break;

      case 'conferenceFactoryUri':
        this._configuration.conferenceFactoryUri = value;
        break;

      case 'capabilities':
        this._configuration.capabilities = value;
        break;

      case 'negotiateUrl':
        this._configuration.negotiateUrl = value;
        break;

      case 'phonebookUrl':
        this._configuration.phonebookUrl = value;
        break;
      
      case 'autopUrl':
        this._configuration.autopUrl = value;
        break;

      case 'anonymous':
        this._configuration.anonymous = value;
        break;

      default:
        return super.set(parameter, value);
    }
  }

  registered(data) 
  {
    super.registered(data);

    this.subscribeApolloService();
  }

  registrationFailed(data) 
  {
    debug(`registrationFailed: ${data.cause}`);

    if (data.cause && data.cause === SIP.C.causes.REDIRECTED) 
    {
      debug('Try redirect');

      const response = data.response;
      let contacts = response.getHeaders('contact').length;
      let contact = null;
      const transportUrl = URL.parse(this._transport.url);
      const sockets = [];

      while (contacts--) 
      {
        contact = response.parseHeader('contact', contacts);
        const server = URL.format({
          hostname : contact.uri.host,
          port     : transportUrl.port || contact.uri.port,
          protocol : transportUrl.protocol,
          slashes  : true
        });

        const socket = SocketInterface.Create({
          server        : server,
          socketOptions : this._configuration.socketOptions,
          proxy         : this._configuration.proxy
        });

        const weight = Number.parseFloat(contact.getParam('q'));

        sockets.push({
          socket : socket,
          weight : weight
        });
      }

      this.stop();
      this.once('disconnected', () => 
      {
        this._transport._setSocket(sockets);
        this._transport._getSocket();
        this.start();
      });
    }
    else 
    {
      super.registrationFailed(data);
    }
  }

  subscribeApolloService() 
  {
    // subscribe apollo control
    if (!this._apolloControl) 
    {
      this._apolloControl = new ApolloControl(this);
      this._apolloControl.on('notify', this.onApolloControl.bind(this));
    }

    this._apolloControl.subscribe([
      ApolloControl.CONTROL_GROUP.DEVICE_CONTROL,
      ApolloControl.CONTROL_GROUP.CONFIG_CONTROL,
      ApolloControl.CONTROL_GROUP.NOTICE_CONTROL
    ]);

    // subscribe apollo provision
    if (!this._apolloProvision) 
    {
      this._apolloProvision = new ApolloProvision(this);
      this._apolloProvision.on('notify', this.onApolloProvision.bind(this));
    }

    this._apolloProvision.subscribe([
      ApolloProvision.PROVISION_GROUP.SERVER_CONFIGURATION,
      ApolloProvision.PROVISION_GROUP.ENDPOINT_CONFIGURATION
    ]);
  }

  onApolloControl(controlGroup, configuration) 
  {
    const action = configuration['action'];
    const actionName = action['@name'];

    switch (controlGroup) 
    {
      case ApolloControl.CONTROL_GROUP.CONFIG_CONTROL:
        if (actionName === 'turnRefresh') 
        {
          const servers = action['configGroup'];
          const iceServers = [];

          for (const server of servers) 
          {
            const {
              Server,
              UDPPort,
              Username,
              Password
            } = server;
            const type = server['@name'] || 'stun';

            iceServers.push({
              urls : URL.format({
                hostname : Server,
                port     : UDPPort,
                protocol : type.toLowerCase(),
                slashes  : false
              }),
              username   : Base64.decode(Username),
              credential : Base64.decode(Password)
            });
          }
          this.set('iceServers', iceServers);
          this.emit('iceServerUpdated', iceServers);
          debug('iceServerUpdated : %o', iceServers);
        }
        break;
      case ApolloControl.CONTROL_GROUP.DEVICE_CONTROL:
        break;
      case ApolloControl.CONTROL_GROUP.NOTICE_CONTROL:
        if (actionName === 'bookConferenceUpdate') 
        {
          const updateInfo = action['xml-body'];

          updateInfo['template-update'] = Utils.booleanify(updateInfo['template-update']);
          updateInfo['schedule-update'] = Utils.booleanify(updateInfo['schedule-update']);

          this.emit('bookConferenceUpdated', updateInfo);
          debug('bookConferenceUpdated : %o', updateInfo);
        }
        break;
    }
  }

  onApolloProvision(provisionGroup, configuration) 
  {
    switch (provisionGroup) 
    {
      case ApolloProvision.PROVISION_GROUP.ENDPOINT_CONFIGURATION:
        for (const attr in configuration) 
        {
          if (configuration.hasOwnProperty(attr)) 
          {
            const value = configuration[attr];

            if (attr === 'phonebook-url') 
            {
              const phonebookUrl = value['@url'];

              this.set('phonebookUrl', phonebookUrl);
              this.emit('phonebookUrlUpdated', phonebookUrl);
              debug('phonebookUrlUpdated : %s', phonebookUrl);
            }
            if (attr === 'negotiate-url') 
            {
              const negotiateUrl = value['@url'];

              this.set('negotiateUrl', negotiateUrl);
              this.emit('negotiateUrlUpdated', negotiateUrl);
              debug('negotiateUrlUpdated : %s', negotiateUrl);
            }
            if (attr === 'autop-url') 
            {
              const autopUrl = value['@url'];

              this.set('autopUrl', autopUrl);
              this.emit('autopUrlUpdated', autopUrl);
              debug('autopUrlUpdated : %s', autopUrl);
            }
          }
        }
        break;
      case ApolloProvision.PROVISION_GROUP.SERVER_CONFIGURATION:
        for (const attr in configuration) 
        {
          if (configuration.hasOwnProperty(attr)) 
          {
            const value = configuration[attr];

            if (attr === 'conference-factory-uri') 
            {
              const conferenceFactoryUri = value;

              this.set('conferenceFactoryUri', conferenceFactoryUri);
              this.emit('conferenceFactoryUriUpdated', conferenceFactoryUri);
              debug('conferenceFactoryUriUpdated : %s', conferenceFactoryUri);
            }
            if (attr === 'capabilities') 
            {
              const capabilities = value;

              this.set('capabilities', capabilities);
              this.emit('capabilitiesUpdated', capabilities);
              debug('capabilitiesUpdated : %o', capabilities);
            }
          }
        }
        break;
    }
  }
};