const Item = require('./Item');
const Utils = require('../../Base/Utils');

module.exports = class User extends Item
{
  constructor(obj)
  {
    super(obj);
  }

  get entity()
  {
    return this.get('@entity');
  }
  get accountType()
  {
    return this.get('account-type');
  }
  get displayText()
  {
    return this.get('display-text');
  }
  get endpoint()
  {
    return Utils.arrayfy(this.get('endpoint'));
  }
  get ip()
  {
    return this.get('ip');
  }
  get phone()
  {
    return this.get('phone');
  }
  get protocol()
  {
    return this.get('protocol');
  }
  get roles()
  {
    const userRoles = {
      'permission'         : 'attendee', // attendee | castviewer | presenter | organizer
      'demostate'          : 'audience', // audience | demonstrator
      'presenterDemostate' : 'audience' // audience | demonstrator
    };
    const rolesEntry = Utils.arrayfy(this.get('roles')['entry']);
    
    rolesEntry.forEach(function(role)
    {
      switch (role['@entity']) 
      {
        case 'permission':
          userRoles.permission = role['#text'];
          break;
        case 'demostate':
          userRoles.demostate = role['#text'];
          break;
        case 'presenter-demostate':
          userRoles.presenterDemostate = role['#text'];
          break;
      }
    });

    return userRoles;
  }
  get uid()
  {
    return this.get('uid');
  }
  get userAgent()
  {
    return this.get('user-agent');
  }

  get mediaList()
  {
    let list = [];

    this.endpoint.forEach((endpoint) => 
    {
      const media = endpoint['media'];

      if (media && Array.isArray(media))
      {
        list = list.concat(media);
      }
      else if (media && typeof media === 'object')
      {
        list.push(media);
      }
    });

    return list;
  }

  // audio-video | focus | applicationsharing
  getEndpoint(type)
  {
    const endpoint = this.endpoint.find(function(e)
    {
      return e['@session-type'] === type;
    });

    return endpoint;
  }

  // main-audio | main-video | applicationsharing
  getMedia(label)
  {
    const media = this.mediaList.find(function(m)
    {
      return m['label'] === label;
    });

    return media;
  }

  getAudioFilter()
  {
    const media = this.getMedia('main-audio') || {};

    return {
      ingress : media['media-ingress-filter'],
      egress  : media['media-egress-filter']
    };
  }

  getVideoFilter()
  {
    const media = this.getMedia('main-video') || {};

    return {
      ingress : media['media-ingress-filter'],
      egress  : media['media-egress-filter']
    };
  }

  isPresenter()
  {
    return this.roles.permission === 'presenter';
  }

  isOnHold()
  {
    const endpoint = this.getEndpoint('focus') || this.getEndpoint('audio-video');

    return endpoint && endpoint.status === 'on-hold';
  }

  isSharing()
  {
    const shareMedia = this.getMedia('applicationsharing');

    return shareMedia && shareMedia['status'] === 'sendonly';
  }

};