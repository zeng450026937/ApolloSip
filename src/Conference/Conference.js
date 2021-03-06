const EventEmitter = require('events').EventEmitter;
const Command = require('../Command/Command');
const Information = require('./Info/Information');
const Description = require('./Info/Description');
const Error = require('../Error/Error');
const Channel = require('../Channel/Channel');
const MediaChannel = require('../Channel/MediaChannel');
const Utils = require('../Base/Utils');
const SIP = require('../Base/SIP');

const debug = SIP.debug('Apollo:Conference');
const warn = SIP.debug('Apollo:Conference:Warn');

warn.log = console.warn.bind(console);

const C = {
  GET_CONFERENCE               : 'getConference',
  GET_BOOK_CONFERENCE_TEMPLATE : 'getBookConferenceTemplate',
  MODIFY_CONFERENCE            : 'modifyConference',
  MODIFY_CONFERNCE_LOCK        : 'modifyConferenceLock',
  ADD_USER                     : 'addUser',
  DELETE_USER                  : 'deleteUser',
  MODIFY_USER_ROLES            : 'modifyUserRoles',
  MODIFY_ENDPOINT_MEDIA        : 'modifyEndpointMedia',
  MODIFY_ENDPOINT_MEDIA_BATCH  : 'modifyEndpointMediaBatch,',
  SET_LOBBY_ACCESS             : 'setLobbyAccess',
  SET_DEMONSTRATOR             : 'setDemonstrator',
  SET_TITLE                    : 'setTitle',
  CANCEL_TITLE                 : 'cancelTitle',
  ADD_RTMP_USER                : 'addRtmpUser',
  ADD_RTMP_USER_BATCH          : 'addRtmpUserBatch',
  MODIFY_RTMP_ENDPOINT_MEDIA   : 'modifyRtmpEpMedia',
  HOLD_RTMP_USER               : 'holdRtmpUser',
  RESUME_RTMP_USER             : 'resumeRtmpUser',

  LobbyAccess : {
    GRANTED : 'granted',
    DENIED  : 'denied'
  },
  UserRole : {
    OGANIZER  : 'organizer',
    ATTENDEE  : 'attendee',
    PRESENTER : 'presenter'
  },
  DemoStatus : {
    ON  : 'OnDemo',
    OFF : 'OffDemo'
  },
  Layout : {
    EQUALITY          : 'Equality',
    SPEECH_EXCITATION : 'SpeechExcitation',
    EXCLUSIVE         : 'Exclusive',
    PRESENTER         : 'Presentation'
  },
  AdmissionPolicy : {
    CLOSE     : 'closedAuthenticated',
    OPEN      : 'openAuthenticated',
    ANONYMOUS : 'anonymous'
  },
  AutoPromote : {
    SPECIFICATE : 0,
    EVERYONE    : 2147483648,
    COMPANY     : 32768
  }
};

module.exports = class Conference extends EventEmitter
{
  static ParseInformation(xml, conference)
  {
    const information = new Information(conference);

    information.update(xml);

    return information;
  }

  static FromInformation(xml, ua)
  {
    const conference = new Conference();

    conference.onNotify(xml);
    conference.entity = conference.information.entity;
    conference.ua = ua;

    return conference;
  }

  constructor()
  {
    super();

    this._ua = undefined;
    this._number = undefined;
    this._pin = undefined;
    this._from = undefined;
    this._error = undefined;
    this._entity = undefined;

    this._information = new Information(this);

    this._focusChannel = new Channel();
    this._mediaChannel = new MediaChannel();
    this._shareChannel = new MediaChannel();

    this._mediaChannel.type = MediaChannel.TYPE.MAIN;
    this._shareChannel.type = MediaChannel.TYPE.SLIDES;

    this._subscription = undefined;

    this._pendings = {};

    this.on('uaChanged', (ua) => 
    {
      this.from = ua.get('uri').toString();
      this.focusChannel.ua = ua;
      this.mediaChannel.ua = ua;
      this.shareChannel.ua = ua;
    });

    const focusHandlers = {
      'accepted' : this.onAccepted.bind(this),
      'ended'    : this.onEnded.bind(this),
      'failed'   : this.onFailed.bind(this),
      'newInfo'  : this.onNewInfo.bind(this)
    };
    const mediaHandlers = {};
    const shareHandlers = {};

    Utils.setupEventHandlers(this.focusChannel, focusHandlers);
  }

  get ua()
  {
    return this._ua;
  }
  set ua(ua)
  {
    if (this._ua !== ua)
    {
      this._ua = ua;
      this.emit('uaChanged', ua);
    }
  }

  get number()
  {
    return this._number;
  }
  set number(number)
  {
    if (this._number !== number)
    {
      this._number = number;
      this.emit('numberChanged', number);
    }
  }

  get pin()
  {
    return this._pin;
  }
  set pin(pin)
  {
    if (this._pin !== pin)
    {
      this._pin = pin;
      this.emit('pinChanged', pin);
    }
  }

  get from()
  {
    return this._from;
  }
  set from(from)
  {
    if (this._from !== from)
    {
      this._from = from;
      this.emit('fromChanged', from);
    }
  }
  
  get entity()
  {
    return this._entity;
  }
  set entity(entity)
  {
    if (this._entity !== entity)
    {
      this._entity = entity;
      this.emit('entityChanged', entity);
    }
  }

  get information()
  {
    return this._information;
  }

  get description()
  {
    return this.information.description;
  }
  get state()
  {
    return this.information.state;
  }
  get view()
  {
    return this.information.view;
  }
  get users()
  {
    return this.information.users;
  }

  get statistics()
  {
    return {
      media : this.mediaChannel.statistics,
      share : this.shareChannel.statistics
    };
  }

  get error()
  {
    return this._error;
  }
  set error(error)
  {
    if (this._error !== error)
    {
      this._error = error;
      this.emit('errorChanged', error);
    }
  }

  get focusChannel()
  {
    return this._focusChannel;
  }
  get mediaChannel()
  {
    return this._mediaChannel;
  }
  get shareChannel()
  {
    return this._shareChannel;
  }

  get media()
  {
    return this._mediaChannel.media;
  }

  isAvariable()
  {
    return this.ua && this.ua.isRegistered();
  }

  isEstablished()
  {
    return this.focusChannel.session && this.focusChannel.session.isEstablished();
  }

  dialIn()
  {
    debug('dialIn()');
    
    const target = `${this.number}**${this.pin}`;

    this._redirect(target)
      .catch((error) =>
      {
        debug('redirect error: %s', error.cause);
        error.originator = 'redirect';
        this.onFailed(error);
        throw error;
      })
      .then((targets) =>
      {
        this.mediaChannel.target = targets[0];
        this.mediaChannel.connect();

        const listeners = {
          'confirmed' : () => 
          {
            Utils.removeEventHandlers(this.mediaChannel, listeners);
            this.entity = this.mediaChannel.entity;
            this.focusChannel.target = this.mediaChannel.focusUri;
            this.connect();
          },
          'failed' : (error) => 
          {
            Utils.removeEventHandlers(this.mediaChannel, listeners);
            this.onFailed(error);
          }
        };

        Utils.setupEventHandlers(this.mediaChannel, listeners);

        return Promise.resolve();
      })
      .catch(() => {});
  }

  connect()
  {
    debug('connect()');

    const requestId = SIP.Utils.createRandomToken(10, 10);
    const body = {};
  
    body[C.ADD_USER] = {
      'conferenceKeys' : {
        '@confEntity' : this.entity
      },
      'user' : {
        '@requestUri' : this.from
      }
    };
  
    const xml = Command.Make(this.from, this.entity, requestId, body);
  
    const options = {
      contentType : 'application/conference-ctrl+xml',
      body        : xml,
      withoutSDP  : true
    };

    this.focusChannel.options = options;
    this.focusChannel.connect();

    this.emit('connecting');
  }

  disconnect()
  {
    this.focusChannel.disconnect();
    this.mediaChannel.disconnect();
    this.shareChannel.disconnect();
    // reset error
    this._error = null;
  }

  parseInformation(xml, attached = false)
  {
    return Conference.ParseInformation(xml, attached?this:null);
  }

  getConference() 
  {
    const body = {};

    body[C.GET_CONFERENCE] = {
      'conferenceKeys' : {
        '@confEntity' : this.entity
      }
    };

    return this._deferSend(body);
  }

  getConferenceTemplate() 
  {
    const body = {};

    body[C.GET_BOOK_CONFERENCE_TEMPLATE] = {
      'conference-info' : {
        '@entity' : this.entity
      }
    };

    return this._deferSend(body);
  }

  // modify conference description & view
  modifyConference(key, params = {}) 
  {
    const conferenceInfo = {
      '@entity' : this.entity,
      '@state'  : 'partial'
    };

    if (!key) 
    { 
      throw new Error('Missing Key');
    }

    if (typeof key !== 'string' ||
     key !== 'conference-view' || 
     key !== 'conference-description')
    {
      throw new Error('Unsupported Key');
    }

    conferenceInfo[key] = params;

    const body = {};

    body[C.MODIFY_CONFERENCE] = {
      'conference-info' : conferenceInfo
    };

    return this._deferSend(body);
  }

  modifyConferenceView(view = {})
  {
    const conferenceView = {
      'entity-view' : {
        '@entity'      : this.mediaChannel.target,
        '@state'       : 'partial',
        'entity-state' : view
      }
    };

    return this.modifyConference('conference-view', conferenceView);
  }

  modifyConferenceDescription(description = {})
  {
    return this.modifyConference('conference-description', description);
  }

  setDefaulFilter({ ingress, egress })
  {
    const filter = {
      'role' : 'default'
    };
    
    if (ingress !== undefined)
    {
      filter['ingressFilter'] = ingress?'unblock':'block';
    }
    if (egress !== undefined)
    {
      filter['egressFilter'] = egress?'unblock':'block';
    }
        
    const filterRule = {
      'mediaFiltersRules' : {
        'initialFilters' : filter
      }
    };

    return this.modifyConferenceView(filterRule);
  }
  setAttendeeFilter({ ingress, egress })
  {
    const filter = {
      'role' : 'attendee'
    };
    
    if (ingress !== undefined)
    {
      filter['ingressFilter'] = ingress?'unblock':'block';
    }
    if (egress !== undefined)
    {
      filter['egressFilter'] = egress?'unblock':'block';
    }
        
    const filterRule = {
      'mediaFiltersRules' : {
        'initialFilters' : filter
      }
    };

    return this.modifyConferenceView(filterRule);
  }

  modifyConferenceLock({ locked, admissionPolicy, autopromote }) 
  {
    const body = {};

    body[C.MODIFY_CONFERNCE_LOCK] = {
      'conferenceKeys' : {
        '@confEntity' : this.entity
      },
      'locked' : locked
    };

    if (!locked)
    {
      body[C.MODIFY_CONFERNCE_LOCK]['admission-policy'] = admissionPolicy;
      body[C.MODIFY_CONFERNCE_LOCK]['autopromote'] = autopromote;
    }

    this._deferSend(body);
  }

  addUser(uris = []) 
  {
    const body = {};
    const user = [];

    if (!Array.isArray(uris)) 
    {
      uris = [ uris ];
    }

    for (const uri of uris) 
    {
      user.push({
        '@requestUri' : uri
      });
    }

    body[C.ADD_USER] = {
      'conferenceKeys' : {
        '@confEntity' : this.entity
      },
      'user' : user
    };

    return this._deferSend(body);
  }

  deleteUser(entity) 
  {
    const body = {};

    body[C.DELETE_USER] = {
      'userKeys' : {
        '@confEntity' : this.entity,
        '@userEntity' : entity
      }
    };

    return this._deferSend(body);
  }

  // only permission role can be modified
  modifyUserRole({ entity, role }) 
  {
    entity = entity || this.from;
    role = role || 'attendee'; // attendee | presenter | organizer

    const body = {};

    body[C.MODIFY_USER_ROLES] = {
      'userKeys' : {
        '@confEntity' : this.entity,
        '@userEntity' : entity
      },
      'user-roles' : {
        'entry' : role
      }
    };

    return this._deferSend(body);
  }

  modifyEndpointMedia({ entity, media }) 
  {
    entity = entity || this.from;
    media = media || {
      'label'                : 'main-audio',
      'media-ingress-filter' : 'unblock',
      'media-egress-filter'  : 'unblock'
    };

    const user = this.users.getUser(entity);

    if (!user)
    {
      throw new Error('Missing User');
    }
  
    const avEndpoint = user.getEndpoint('audio-video');

    if (!avEndpoint)
    {
      throw new Error('Missing AV Endpoint');
    }

    const userMedia = user.getMedia(media.label);

    if (!userMedia) { throw new Error('Missing User Media'); }

    const body = {};

    body[C.MODIFY_ENDPOINT_MEDIA] = {
      '@mcuUri'   : this.mediaChannel.target,
      'mediaKeys' : {
        '@confEntity'     : this.entity,
        '@userEntity'     : entity,
        '@endpointEntity' : avEndpoint['@entity'],
        '@mediaId'        : userMedia['@id']
      },
      'media' : media
    };

    return this._deferSend(body);
  }

  modifyEndpointMediaBatch({ entity, media }) 
  {
    const userEntity = [];

    if (!Array.isArray(entity)) 
    {
      entity = [ entity ];
    }

    for (const e of entity) 
    {
      userEntity.push({
        '#text' : e
      });
    }

    const userMedia = [];

    if (!Array.isArray(media)) 
    {
      media = [ media ];
    }

    for (const m of media) 
    {
      m['@id'] = m['label']==='main-audio'?1:
        m['label']==='main-video'?2:1;

      userMedia.push(m);
    }

    const body = {};

    body[C.MODIFY_ENDPOINT_MEDIA] = {
      'conferenceKeys' : {
        '@confEntity' : this.entity
      },
      'userEntity' : userEntity,
      'endpoint'   : {
        '@session-type' : 'audio-video',
        'media'         : userMedia
      }
    };

    return this._deferSend(body);
  }

  setLobbyAccess({ entity, granted }) 
  {
    const body = {};
    const userEntity = [];

    if (!Array.isArray(entity)) 
    {
      entity = [ entity ];
    }

    for (const e of entity) 
    {
      userEntity.push({
        '#text' : e
      });
    }

    body[C.SET_LOBBY_ACCESS] = {
      'conferenceKeys' : {
        '@confEntity' : this.entity
      },
      'userEntity' : userEntity,
      'access'     : granted?C.LobbyAccess.GRANTED:C.LobbyAccess.DENIED
    };

    return this._deferSend(body);
  }

  setDemonstrator({ entity, enable }) 
  {
    const body = {};
    const userEntity = [];

    if (!Array.isArray(entity)) 
    {
      entity = [ entity ];
    }

    for (const value of entity) 
    {
      userEntity.push({
        '#text' : value
      });
    }

    body[C.SET_DEMONSTRATOR] = {
      'conferenceKeys' : {
        '@confEntity' : this.entity
      },
      'userEntity' : userEntity,
      'demoState'  : enable?C.DemoState.ON:C.DemoState.OFF
    };

    return this._deferSend(body);
  }

  setTitle({ entity, title }) 
  {
    entity = entity || [ this.from ];
    title = title || {
      type           : 'Static', // Static|Dynamic
      repeatCount    : 3,
      repeatInterval : 5,
      displayTime    : 5,
      displayText    : 'title',
      position       : 'top', // top|medium|bottom
      rollDirection  : 'R2L' // R2L|L2R
    };

    if (!Array.isArray(entity)) 
    {
      entity = [ entity ];
    }

    const userEntity = [];

    for (const value of entity) 
    {
      userEntity.push({
        '#text' : value
      });
    }

    const body = {};

    body[C.SET_TITLE] = {
      'conferenceKeys' : {
        '@confEntity' : this.entity
      }
    };

    if (userEntity.length > 0)
    {
      body[C.SET_TITLE]['userEntity'] = userEntity;
    }

    Object.assign(body[C.SET_TITLE], title);

    return this._deferSend(body);
  }

  cancelTitle() 
  {
    const body = {};

    body[C.CANCEL_TITLE] = {};

    Object.assign(body[C.SET_TITLE], {
      'conferenceKeys' : {
        '@confEntity' : this.entity
      }
    });

    return this._deferSend(body);
  }

  addRtmpUser(rtmpUser)
  {
    const body = {};

    body[C.ADD_RTMP_USER] = {
      'conferenceKeys' : {
        '@confEntity' : this.entity
      },
      'rtmp-user' : rtmpUser
    };

    return this._deferSend(body);
  }

  addRtmpUserBatch(rtmpUser) 
  {
    if (!Array.isArray(rtmpUser)) 
    {
      rtmpUser = [ rtmpUser ];
    }

    const body = {};

    body[C.ADD_RTMP_USER_BATCH] = {};

    Object.assign(body[C.ADD_RTMP_USER_BATCH], {
      'conferenceKeys' : {
        '@confEntity' : this.entity
      },
      'rtmp-user' : rtmpUser
    });

    return this._deferSend(body);
  }

  modifyRtmpEndpointMedia({ entity, endpoint }) 
  {
    const body = {};

    body[C.MODIFY_RTMP_ENDPOINT_MEDIA] = {};

    Object.assign(body[C.MODIFY_RTMP_ENDPOINT_MEDIA], {
      'userKeys' : {
        '@confEntity' : this.entity,
        '@userEntity' : entity
      },
      'endpoint' : endpoint
    });

    return this._deferSend(body);
  }

  holdRtmpUser(entity) 
  {
    const body = {};

    body[C.HOLD_RTMP_USER] = {};

    Object.assign(body[C.HOLD_RTMP_USER], {
      'userKeys' : {
        '@confEntity' : this.entity,
        '@userEntity' : entity
      }
    });

    return this._deferSend(body);
  }

  resumeRtmpUser(entity) 
  {
    const body = {};

    body[C.RESUME_RTMP_USER] = {};

    Object.assign(body[C.RESUME_RTMP_USER], {
      'userKeys' : {
        '@confEntity' : this.entity,
        '@userEntity' : entity
      }
    });

    return this._deferSend(body);
  }

  onAccepted(data)
  {
    let response = data.response;

    if (!response.body)
    {
      data.cause = 'Missing Body';
      this.onFailed(data);
      this.disconnect();

      return;
    }

    response = Command.Parse(response.body);

    if (!response)
    {
      data.cause = 'Parse Response Failed';
      this.onFailed(data);
      this.disconnect();
      
      return;
    }

    debug('focus response: %o', response);

    this.from = response[C.ADD_USER]['user']['@entity'];

    this._subscribe();
    
    this.emit('connected');
  }

  onEnded(data)
  {
    if (this._subscription)
    {
      this._subscription.terminate();
    }

    this.information.clear();

    this.emit('disconnected', data);
  }

  onFailed(data)
  {
    this.error = data;

    this.emit('connectFailed', data);
  }

  onNewInfo(data)
  {
    if (data.originator === 'remote' && data.info.contentType === 'application/conference-ctrl+xml')
    {
      const response = Command.Parse(data.info.body);
      const requestId = response['@requestId'];
      const code = response['@code'];
      const defer = this._pendings[requestId];

      if (!defer)
      {
        debug('Received unknown conference-ctrl');

        return;
      }

      if (!response) 
      {
        data.cause = 'Missing Content';
        defer.reject(data);
  
        return;
      }
  
      let result;
  
      for (const attr in response) 
      {
        if (!(/^@/.test(attr))) 
        {
          debug('info command: %s', attr);
          debug('info result: %o', response[attr]);
          result = response[attr];
        }
      }
  
      switch (code)
      {
        case 'success':
          defer.resolve(result);
          break;
        case 'failure':
          data.cause = code;
          data.result = result;
          defer.reject(data);
          break;
        default:
          break;
      }
    }
  }

  onNotify(data)
  {
    this.information.update(data.notify);
    this.emit('informationUpdated', this.information);
  }

  _descriptionUpdated()
  {
    let uris = this.description.confUris || {};

    uris = Utils.arrayfy(uris['entry']);

    uris.forEach(function(entry)
    {
      const { purpose, uri } = entry;

      debug('%s uri: %s', purpose, uri);

      switch (purpose) 
      {
        case 'focus':
          this.focusChannel.target = uri;
          break;
        case 'audio-video':
          this.mediaChannel.target = uri;
          break;
        case 'applicationsharing':
          this.shareChannel.target = uri;
          break;
      }
    }, this);  

    this.emit('descriptionUpdated', this.description);
  }
  _stateUpdated()
  {
    this.emit('stateUpdated', this.state);
  } 
  _viewUpdated()
  {
    this.emit('viewUpdated', this.view);
  }
  _usersUpdated()
  {
    this.emit('usersUpdated', this.users);
  }
  
  _userUpdated(users = [])
  {
    debug('userUpdated()');

    if (users.length < 1)
    {
      warn('Missing User Info');
    }

    users.forEach(function(user)
    {
      debug('updated user: %s', user.displayText);
      this.emit('userUpdated', user);
    }, this);
  }
  _userAdded(users = [])
  {
    debug('userAdded()');

    if (users.length < 1)
    {
      warn('Missing User Info');
    }

    users.forEach(function(user)
    {
      debug('added user: %s', user.displayText);
      this.emit('userAdded', user);
    }, this);
  }
  _userDeleted(users = [])
  {
    debug('userDeleted()');

    if (users.length < 1)
    {
      warn('Missing User Info');
    }

    users.forEach(function(user)
    {
      debug('deleted user: %s', user.displayText);
      this.emit('userDeleted', user);
    }, this);
  }

  _redirect(target)
  {
    debug('redirect()');

    const defer = Utils.defer();

    let session = this.ua.call(target, { withoutSDP: true });

    session.once('failed', (data) =>
    {
      debug('Invite failed. cause: %s', data.cause);

      const message = data.message;

      if (!message)
      {
        defer.reject(new Error.FreeSwitchError(data));
        
        return;
      }

      switch (true) 
      {
        case /^30[1-2]$/.test(message.status_code):
          {
            let contacts = message.getHeaders('contact').length;
            let contact = {};
            const targets = [];

            while (contacts--) 
            {
              contact = message.parseHeader('contact', contacts);
              targets.push(contact.uri.toString());
            }

            debug('get conference uris: %o', targets);

            // should have a least one contactUri.
            if (targets.length) 
            {
              defer.resolve(targets);
            }
            else 
            {
              data.cause = SIP.C.causes.NOT_FOUND;
              defer.reject(new Error.FreeSwitchError(data));
            }
          }
          break;
        case /^480$/.test(message.status_code):
          {
            const info = Utils.objectify(message.body)['conference-info'];
            const description = new Description();
            const error = new Error.FreeSwitchError(data);

            description.update(info['conference-description'], true);
            error.code = message.status_code;
            error.description = description;
            defer.reject(error);
          }
          break;
        default:
          defer.reject(new Error.FreeSwitchError(data));
          break;
      }

      session = null;
    });

    return defer.promise;
  }

  _subscribe()
  {
    const event = 'conference';
    const expires = 3600;
    const extraHeaders = [
      'Accept: application/conference-info+xml'
    ];

    this._subscription = this._ua.subscribe(this.focusChannel.target, event, {
      expires       : expires,
      extraHeaders  : extraHeaders,
      eventHandlers : {
        progress : () =>
        {
          debug('subscription progress.');
        },
        successed : () =>
        {
          debug('subscription successed.');
        },
        failed : (data) =>
        {
          debug('subscription failed. %s', data.cause);
        },
        notify : (data) =>
        {
          this.onNotify(data);
        }
      }
    });
  }

  _deferSend(body) 
  {
    const defer = Utils.defer();
    const requestId = SIP.Utils.createRandomToken(10, 10);
    const xml = Command.Make(this.from, this.entity, requestId, body);
    const options = {
      eventHandlers : {
        succeeded : (data) =>
        {
          debug('info succeeded: %s', data.originator);
    
          const response = Command.Parse(data.response.body);
    
          if (!response) 
          {
            data.cause = 'Missing Content';
            defer.reject(data);
    
            return;
          }

          const code = response['@code'];
          let result;

          for (const attr in response) 
          {
            if (!(/^@/.test(attr))) 
            {
              debug('info command: %s', attr);
              debug('info result: %o', response[attr]);
              result = response[attr];
            }
          }

          switch (code)
          {
            case 'success':
              defer.resolve(result);
              break;
            case 'failure':
              data.cause = code;
              data.result = result;
              defer.reject(data);
              break;
            case 'pending':
              this._pendings[requestId] = defer;
              break;
            default:
              break;
          }
        },
        failed : (data) =>
        {
          data.cause = SIP.C.causes.SIP_FAILURE_CODE;
          defer.reject(data);
        }
      }
    };
    const contentType = 'application/conference-ctrl+xml';
    
    this.focusChannel.session.sendInfo(contentType, xml, options);

    return defer.promise;
  }
};