Function.prototype.bindWithEval = function(obj) {
    var __method = this;
    return function(r) {
        var txt = r.transport ? r.transport.responseText: r.responseText;
        return __method.call(obj, eval('(' + txt + ')'));
    };
};

Lingr = Class.create();
Lingr.prototype = {
    initialize: function(options) {
        this.options = {
            prefix: Math.round(Math.random() * 100) + '.',
            prefixForObserve: Math.round(Math.random() * 100) + 'o.',
            apiDomain: 'www.lingr.com',
            dsrTimeout: 9000,
            userMessagesOnly: false,
            clientType: 'human'
        };

        Object.extend(this.options, options || {});

        this.options.useDsr = this.options.useDsr && document.domain != this.options.apiDomain;
        this.callbackNum = 0;

        this.cookieName = '__lingr';

        this.options.session = this.options.session || this.readCookie();
    },

    emptyFunction: function() {},

    url: function(path, observe) {
        var prefix = observe ? this.options.prefixForObserve : this.options.prefix;
        return "http://" + prefix + this.options.apiDomain + '/api' + path;
    },

    formatParams: function(params) {
        return $H(params).merge({ format: 'json'}).toQueryString();
    },

    request: function(method, path, params, options) {
        options = options || {};
        var head = document.getElementsByTagName('head')[0];
        var url = this.url(path, options.observe);
        var script;
        if (this.options.useDsr) {

            Lingr['callback' + this.callbackNum] = function(json) {
                if (json && json.status == 'ok') {
                    (options.onSuccess || this.emptyFunction)(json);
                } else {
                    (options.onFailure || this.emptyFunction)(json);
                }
                head.removeChild(script);
            }.bind(this);

            params.callback = 'Lingr.callback' + this.callbackNum;

            this.callbackNum++;

            try {
                script = document.createElement('script');
                script.type = 'text/javascript';
                script.charset = 'UTF-8';
                script.src = url + '?' + this.formatParams(params);
                head.appendChild(script);
                this.timeout = setTimeout(params.callback, options.timeout || this.options.dsrTimeout);
            } catch(e) {
                (options.onException || this.emptyFunction)(this, e);
            }
        }
        else {
            new Ajax.Request(url, {
                method: method,
                parameters: this.formatParams(params),
                onSuccess: (options.onSuccess || this.emptyFunction).bindWithEval(this),
                onFailure: (options.onFailure || this.emptyFunction).bindWithEval(this),
                onException: (options.onException || this.emptyFunction).bind(this)
            });
        }
    },

    _setCookie: function(name, value, expires) {
        var exp = '';

        if (expires) {
            var date = new Date();
            date.setTime(date.getTime()+(expires*1000));
            exp = "; expires="+date.toGMTString();
        }

        document.cookie = name + "=" + value + exp;
    },

    setCookie: function(session) {
        this._setCookie(this.cookieName, session);
    },

    readCookie: function() {
        var nameEQ = this.cookieName + '=';
        var cookies = document.cookie.split(';');
        for(var i=0;i < cookies.length;i++) {
            var c = cookies[i].strip();
            if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length,c.length);
        }
        return null;
    },

    clearCookie: function() {
        this._setCookie(this.cookieName, '', -1);
    },

    dispatchEvent: function(eventName, json) {
        (this.options['on' + eventName] || this.emptyFunction)(json);
    },

    start: function() {
        this.session = new Lingr.Session(this);
        this.session.start();
    },

    say: function(message, occupantId) {
        if (this.session && this.session.room) {
            this.session.room.say(message, occupantId);
        }
    },

    getNickname: function() {
        if (this.session && this.session.room) {
            return this.session.room.nickname;
        } else {
            return null;
        }
    },

    setNickname: function(nickname) {
        if (this.session && this.session.room) {
            this.session.room.setNickname(nickname);
        }
    }
};

Lingr.Session = Class.create();
Lingr.Session.prototype = {
    initialize: function(lingr, session) {
        this.lingr = lingr;
        this.session = lingr.options.session;
    },

    start: function() {
        if (!this.session) {
            this.lingr.request('post', '/session/create', {
                api_key: this.lingr.options.apiKey,
                client_type: this.lingr.options.clientType
            }, {
                onSuccess: function(json) {
                    this.session = json.session;
                    this.lingr.setCookie(this.session);
                    this.lingr.dispatchEvent('SessionCreated', json);
                    this.authenticate();
                }.bind(this),
                onFailure: function(json) {
                    this.lingr.dispatchEvent('ApiFailure', json);
                }.bind(this)
            });
        }
        else {
            this.lingr.request('post', '/session/verify', {
                session: this.session
            }, {
                onSuccess: function(json) {
                    this.lingr.setCookie(this.session);
                    this.enterRoom();
                }.bind(this),
                onFailure: function(json) {
                    this.session = null;
                    this.start();
                }.bind(this)
            });
        }
    },

    authenticate: function() {
        if (this.lingr.options.email && this.lingr.options.password)
        {
            var a = new Lingr.Auth(this);
            a.login({
                onSuccess: function(json) {
                    this.lingr.dispatchEvent('SessionAuthenticated', json);
                    this.enterRoom();
                }.bind(this),
                onFailure: function(json) {
                    this.lingr.dispatchEvent('ApiFailure', json);
                    this.end();
                }.bind(this)
            });
        }
        else
        {
            this.enterRoom();
        }
    },

    enterRoom: function() {
        this.room = new Lingr.Room(this, this.lingr.options.roomId, this.lingr.options.nickname);
        this.room.enter();
    },

    end: function() {
        if (this.session) {
            this.lingr.request('post', '/session/destroy', {
                session: this.session }, {
                    onSuccess: function(json) {
                        this.session = null;
                        this.lingr.clearCookie();
                        this.lingr.dispatchEvent('SessionDestroyed', json);
                    }.bind(this),
                    onFailure: function(json) {
                        this.session = null;
                        this.lingr.clearCookie();
                        this.lingr.dispatchEvent('ApiFailure', json);
                    }.bind(this)
                });
        }
    }
};

Lingr.Auth = Class.create();
Lingr.Auth.prototype = {
    initialize: function(session) {
        this.session = session;
    },

    login: function(options) {
        this.session.lingr.request('post', '/auth/login', {
            session: this.session.session,
            email: this.session.lingr.options.email,
            password: this.session.lingr.options.password
        }, options);
    },

    logout: function() {
        this.session.lingr.request('post', '/auth/logout', { session: this.session.session }, options);
    }
};

Lingr.Room = Class.create();
Lingr.Room.prototype = {
    initialize: function(session, roomId, nickname) {
        this.session = session;
        this.roomId = roomId;
        this.nickname = nickname;
        this.ticket = this.session.lingr.options.ticket;
    },

    enter: function() {
        if (!this.ticket) {
            params = {
                session: this.session.session,
                id: this.roomId,
                idempotent: true
            };

            if (this.nickname) {
                params.nickname = this.nickname;
            }

            this.session.lingr.request('post', '/room/enter', params, {
                onSuccess: function(json) {
                    this.ticket = json.ticket;
                    this.counter = json.room.counter;

                    this.session.lingr.dispatchEvent('RoomEntered', json.room);

                    if (json.occupants) {
                        this.session.lingr.dispatchEvent('RosterUpdated', json.occupants);
                    }

                    this.getContext();
                }.bind(this),
                onFailure: function(json) {
                    this.session.lingr.dispatchEvent('ApiFailure', json);
                }.bind(this)
            });
        }
        else {
            this.getContext();
        }
    },

    setNickname: function(nickname) {
        this.nickname = nickname;
        if (!this.ticket) return;
        var params = {
            session: this.session.session,
            ticket: this.ticket,
            nickname: this.nickname
        };
        this.session.lingr.request('post', '/room/set_nickname', params, {
            onSuccess: function(json) {
                this.session.lingr.dispatchEvent('NicknameChanged', json);
            }.bind(this),
            onFailure: function(json) {
                this.session.lingr.dispatchEvent('ApiFailure', json);
            }.bind(this)
        });
    },

    getContext: function() {
        if (this.session.lingr.options.contextLines) {
            this.session.lingr.request('get', '/room/get_messages', {
                session: this.session.session,
                ticket: this.ticket,
                counter: -this.session.lingr.options.contextLines,
                user_messages_only: this.session.lingr.options.userMessagesOnly
            } , {
                onSuccess: function(json) {
                    if (json.messages && json.messages.length > 0) {
                        this.session.lingr.dispatchEvent('MessagesReceived', json.messages);
                    }

                    this.counter = json.counter;
                    this.observe();
                }.bind(this),
                onFailure: function(json) {
                    this.session.lingr.dispatchEvent('ApiFailure', json);
                    this.observe();
                }.bind(this)
            });
        }
        else {
            this.observe();
        }
    },

    observe: function() {
        this.session.lingr.request('get', '/room/observe', {
            session: this.session.session,
            ticket: this.ticket,
            counter: this.counter
        }, {
            onSuccess: function(json) {
                if (json.occupants) {
                    this.session.lingr.dispatchEvent('RosterUpdated', json.occupants);
                }

                if (json.messages && json.messages.length > 0) {
                    var msgs = json.messages.findAll(function(v, i) { return !this.session.lingr.options.userMessagesOnly || (v.type == 'user') || (v.type == 'private'); }.bind(this));
                    this.session.lingr.dispatchEvent('MessagesReceived', msgs);
                }

                if (json.counter) {
                    this.counter = json.counter;
                }

                this.observe();
            }.bind(this),
            onFailure: function(json) {
                this.session.lingr.dispatchEvent('ApiFailure', json);
            },
            observe: true
        });
    },

    say: function(message, occupantId) {
        params = {
            session: this.session.session,
            ticket: this.ticket,
            message: message
        };

        if (occupantId) {
            params.occupant_id = occupant_id;
        }

        this.session.lingr.request('post', '/room/say', params, {
            onSuccess: function(json) {
                this.session.lingr.dispatchEvent('Said', json);
            }.bind(this),
            onFailure: function(json) {
                this.session.lingr.dispatchEvent('ApiFailure', json);
            }.bind(this)
        });
    },

    leave: function() {
        if (this.ticket) {
            this.session.lingr.request('post', '/room/exit', {
                session: this.session.session,
                ticket: this.ticket
            }, {
                onSuccess: function(json) {
                    this.session.lingr.dispatchEvent('RoomExited', json);
                    this.ticket = null;
                    this.session.end();
                }.bind(this),
                onFailure: function(json) {
                    this.session.lingr.dispatchEvent('ApiFailure', json);
                }.bind(this)
            });
        }
    }
};

