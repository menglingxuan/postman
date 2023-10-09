(parserShadow => {
    let src = parserShadow.toString().substring(8);
    pm.environment.set("__postman.script.parser__", src);
    pm.environment.set("__postman.script.evalsr__", ((fn) => `
(parserShadow => parserShadow.call(this, [pm, postman, console, this, 
    require("postman-collection"), _, CryptoJS, ${_.isFunction(fn) 
        ? (this._evalsr = fn) && "this._evalsr" /** tips: 通过使用全局变量兼容匿名函数 */
        : `"${Object.prototype.toString.call(fn)}"`}, true])
)(args => ${pm.variables.get("__postman.script.parser__")})`).toString());
    src = null;
    return parserShadow.call(this, [pm, postman, console,
        this, require("postman-collection"), _, CryptoJS, null, false]);
})(args => (async function (pm, postman, console, global, sdk, _, CryptoJS, selfScript, isEvalMode) {
    const SystemError = new Proxy(class _SystemError extends Error {
        static _isSystemError = true;
        static _lineSeperator = "——".repeat(50);

        static hasSignal(e, name) { return e instanceof SystemError && e._signals.has(Symbol.for(name)); };
        static isCancelSinal(e) { return Boolean(e.constructor._isCancelSinal); };

        /**
         * examples:
         *      new SystemError("message", ....)        // first arg is <String>
         *      new SystemError(systemError, ....)      // first arg is <SystemError>
         *      new SystemError(error, ....)            // first arg is <Error>
         *      new SystemError({}, ....)               // first arg is <Object>
         *      new SystemError([], ....)               // first arg is <Object> too
         *      new SystemError(123, ....)              // first arg is basic data type
         *      new SystemError | new SystemError()     // no arg
         */
        constructor(message, ...args) {
            super(message);
            this.args = args;
            this.label = null;

            this._previousInfo = [];
            this._signals = new Set();
            message || (this.message = "系统错误");
        }

        get _currentInfo() {
            return {
                args: this.args,
                label: this.label,
                message: this.message,
                warnings: this.warnings,
                stack: this.stack,
                remoteStack: this.remoteStack
            };
        }

        withStack(stack) {
            this.stack = stack;
            return this;
        }

        withRemoteStack(stack) {
            this.remoteStack = (Array.isArray(stack)
                ? stack.join("\n")
                : stack || "").replace(/^/gm, "    ").trim();
            return this;
        }

        withWarnings(warnings) {
            if (warnings) {
                this.warnings = Array.isArray(warnings) ? warnings : [warnings];
            }
            return this;
        }

        withLabel(name) {
            if (name) {
                this.label = name;
                this.message = this.label + "：" + this.message;
            }
            return this;
        }

        withMessage(message) {
            this.message = message;
            return this;
        }

        withSignal(name) {
            if (!this._signals.has(Symbol.for(name))) {
                this._signals.add(Symbol.for(name));
            }
            return this;
        }

        printDetail() {
            const current = this._currentInfo;
            current.warnings && current.warnings.each(msg => console.warn("warning(from remote): " + msg));
            current.stack && console.error("stack: \n", current.stack);
            current.remoteStack && console.error("remote stack: \n", current.remoteStack);
            delete current.stack; delete current.remoteStack;
            console.error("info: \n", current);

            this._previousInfo.reverse().forEach(function(previous) {
                delete previous.stack; delete previous.remoteStack;
                console.error("previous info: \n", previous);
            }.bind(this));

            console.error(this.constructor._lineSeperator);
        }
    }, {
        construct: function(target, argsList, newTarget) {
            let message = argsList[0], args = argsList.slice(1);
            if (message instanceof Error) {
                let error = message;
                if (error.constructor._isSystemError) {
                    error._previousInfo.push(error._currentInfo);
                    error._signals = error._signals;    // no change
                    error.args = args;
                    return error;
                }
                return Reflect.construct(target, [error.message, ...args], newTarget).withStack(error.stack);
            } else
            if (_.isObject(message)) {
                return Reflect.construct(target, [this.KNOWN_OBJECTY_ERRORS(message), ...argsList], newTarget);
            } else {
                return Reflect.construct(target, [message, ...args], newTarget);
            }
        },

        UNKNOWN_OBJECTY_ERROR: "未定义的错误",

        KNOWN_OBJECTY_ERRORS: function(obj) {
            switch(true) {
                case obj.hasOwnProperty("syscall") && obj.hasOwnProperty("errno"):
                    return JSON.stringify(Object.assign(
                        obj.errno ? { errno: obj.errno } : {},
                        obj.code ? { code: obj.code } : {},
                        obj.syscall ? { syscall: obj.syscall } : {}));
                case typeof SendResult != undefined && obj instanceof SendResult:
                    if (obj.reason instanceof Error) {
                        return obj.reason.message;
                    }
                default:
                    log.error("未经转换的错误", obj);
                    return this.UNKNOWN_OBJECTY_ERROR;
            }
        }
    });

    const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;

    if (isEvalMode) {
        // tips: _.isFunctioin() 仅检测普通函数，不包括异步函数和生成器函数
        if (!_.isFunction(selfScript)) {
            throw new SystemError(`参数必须为一个普通函数，实际类型：${selfScript}}`)
            .withLabel("__postman.script.evalsr__::fn");
        }
    }

    /**
     * TODO：考虑简化甚至去除
     *
     * #examples:
     * ## define - 4 args
     * defineReadOnly(obj, name, value, true)
     * defineReadOnly(obj, name, <Function>, true)
     * defineReadOnly(obj, [name1, name2], [value1, <Function>], true)
     *
     * ## modify - 3 args
     * defineReadOnly(obj, [name], true)
     * defineReadOnly(obj, ["*"], true)
     * defineReadOnly(obj, ["!", name], true)
     *
     * #illegal
     * defineReadOnly(obj, name, true)
     */
    const defineReadOnly = function(obj, name, value, enumerable, _changeWritable, _defineVisible) {
        function _modify(obj, attrs, invert, enumerable, _changeWritable) {
            return Object.entries(Object.getOwnPropertyDescriptors(obj))
            .reduce((o, [attr, descriptor]) => {
                if (invert ? !attrs.includes(attr) : attrs.includes(attr)) {
                    if (!descriptor.configurable) {
                        return o;
                    }
                    descriptor.configurable = false;
                    descriptor.writable === true && _changeWritable && (descriptor.writable = false);
                    descriptor.enumerable = enumerable;
                    if (o === undefined) {
                        // tips: 遇到一种 o === undefined（attr, descriptor变量值正常），但 o 对应的原始参数确实不是<undefined>的情况。具体实例：在 _ensureInvoker() 中 defineReadOnly(this, ["_cache"], false) 一句会引发此问题。怀疑跟序列化<Proxy>对象有关。
                        // 解决方案：下面改用 arguments[0]，而不用 o
                    }
                    return Object.defineProperty(arguments[0], attr, descriptor);
                }
            }, obj);
        }

        function _define(obj, attrs, values, enumerable) {
            if (attrs.length !== values.length) {
                throw new SystemError;
            }
            return Object.defineProperties(obj, [...attrs.entries()]
            .reduce((descriptors, [index, attr]) => {
                let value = values[index], descriptor = {
                    configurable: false,
                    enumerable: enumerable,
                };
                if (typeof value === "function") {
                    descriptor.get = value;
                } else {
                    descriptor.writable = false;
                    descriptor.value = value;
                }
                descriptors[attr] = descriptor;
                return descriptors;
            }, {}));
        }

        if (Array.isArray(name)) {
            if (typeof value === "boolean"
                && (arguments.length === ((_defineVisible = _changeWritable) ? 5 : 3))) {
                let attrs = name,
                    _enumerable = value,
                    _changeWritable = enumerable == undefined ? true : enumerable,
                    flag = attrs.length > 0 ? attrs[0] : "",
                    isInvertMode = flag === "!";
                isInvertMode && attrs.splice(0, 1);
                return _modify(obj, attrs, isInvertMode, _enumerable, _changeWritable);
            } else
            if (Array.isArray(value) && arguments.length === 4) {
                let attrs = name, values = value;
                return _define(obj, attrs, values, enumerable);
            }
            throw new SystemError;
        }
        return _define(obj, [name], [value], enumerable);
    };

    const log = [0, 1, 2, 3, 4, 5].reduce((that, flag) => {
        const prototype = Object.getPrototypeOf(that);
        const [level, fn] = that.C._levels[flag];
        prototype[level] = function(...args) {
            if (!this._emitted) {
                this._msgs.push([[this._prefix(level), ...args], fn, flag]);
            } else
            if (this.flag >= flag) {
                fn.call(console, this._prefix(level), ...args);
            }
            return true;
        }
        return that;
    }, new class _Logger {
        static _levels = [
            ["log", console.log, 0], ["error", console.error, 1], ["warn", console.warn, 2],
            ["info", console.info, 3],  ["debug", console.log, 4], ["verbose", console.log, 5]
        ];
        static _flagMap = new Map(_Logger._levels.map(([level, func, flag]) => [level, flag]));
        static levels = [..._Logger._flagMap.keys()].slice(1);
        static hasLevel = (name => _Logger.levels.includes(name));

        constructor() {
            this._level = "warn";
            this._emitted = false;
            this._msgs = [];
            this.C = this.constructor;
            this.type = pm.info.eventName;
            this.level = this._level;
        }

        get flag() {
            return this.C._flagMap.get(this.level);
        }

        get level() {
            return this._level;
        }

        set level(level) {
            typeof level !== "string" ? null : level.toLowerCase();
            if (!this.C.hasLevel(level)) {
                throw new SystemError;
            }
            this._level = level;
        }

        _prefix(level) {
            const now = new Date(),
                hour = now.getHours().toString().padStart(2, "0"),
                minute = now.getMinutes().toString().padStart(2, "0"),
                second = now.getSeconds().toString().padStart(2, "0"),
                milliSecond = now.getMilliseconds().toString().padStart(3, "0"),
                currentTimestamp = `${hour}:${minute}:${second}.${milliSecond}`;
            return `[::${level}::${currentTimestamp}::${this.type}\\${this.level}::]`
        }

        setLevel(level) {
            this.level = level;
        }

        emit() {
            this._emitted = true;
            this._msgs.forEach(function([msgs, fn, flag]) {
                if (this.flag >= flag) {
                    fn.call(console, ...msgs);
                }
            }, this);
            this._msgs = [];
        }
    });

    log.info(`开始执行，请求名称`, {
        requestId: pm.info.requestId,
        requestName: pm.info.requestName,
        iterationCount: pm.info.iterationCount,
        iteration: pm.info.iteration,
    });

    const CancelSignal = class extends SystemError {
        static _isCancelSinal = true;

        constructor(subject, ...args) {
            super(...args);
            defineReadOnly(global, "_isCancelSignal", true, false);
            log.warn(`接收到来自 ${subject} 的中止信号，剩余未处理的特性任务将取消执行`, ...args);
        }
    };

    defineReadOnly(global, "_globalTimer", setTimeout(() => {}, 123456789), false);

    const libs = {
        // sanbox library
        get ajv() { return require("ajv"); },
        get atob() { return require("atob"); },
        get btoa() { return require("btoa"); },
        get chai() { return require("chai"); },
        get cheerio() { return require("cheerio"); },
        get cryptojs() { return require("crypto-js"); },
        get csvsync() { return require("csv-parse/lib/sync"); },
        get lodash() { return require("lodash"); },
        get moment() { return require("moment"); },
        get sdk() { return require("postman-collection"); },
        get tv4() { return require("tv4"); },
        get uuid() { return require("uuid"); },
        get xml2js() { return require("xml2js"); },
        // node module
        get path() { return require("path"); },
        get assert() { return require("assert"); },
        get buffer() { return require("buffer"); },
        get util() { return require("util"); },
        get url() { return require("url"); },
        get punycode() { return require("punycode"); },
        get querystring() { return require("querystring"); },
        get string_decoder() { return require("string-decoder"); },
        get stream() { return require("stream"); },
        get timers() { return require("timers"); },
        get events() { return require("events"); }
    };

    const parameters = new class _Parameters {
        static REQ_METHOD_GET = "GET";
        static REQ_METHOD_POST = "POST";
        static REQ_METHOD_PUT = "PUT";
        static REQ_METHOD_PATCH = "PATCH";
        static REQ_METHOD_DELETE = "DELETE";
        static REQ_METHOD_COPY = "COPY";
        static REQ_METHOD_HEAD = "HEAD";
        static REQ_METHOD_OPTIONS = "OPTIONS";
        static REQ_METHOD_LINK = "LINK";
        static REQ_METHOD_UNLINK = "UNLINK";
        static REQ_METHOD_PURGE = "PURGE";
        static REQ_METHOD_LOCK = "LOCK";
        static REQ_METHOD_UNLOCK = "UNLOCK";
        static REQ_METHOD_PROPFIND = "PROPFIND";
        static REQ_METHOD_VIEW = "VIEW";
        static AUTH_TYPE_NOAUTH = "noauth";
        static AUTH_TYPE_APIKEY = "apikey";
        static AUTH_TYPE_BEARER = "bearer";
        static AUTH_TYPE_BASIC = "basic";
        static AUTH_TYPE_DIGEST = "digest";
        static AUTH_TYPE_OAUTH1 = "oauth1";
        static AUTH_TYPE_OAUTH1 = "oauth2";
        static AUTH_TYPE_HAWK = "hawk";
        static AUTH_TYPE_AWS = "awsv4";
        static AUTH_TYPE_NTLM = "ntlm";
        static AUTH_TYPE_EDGEGRID = "edgegrid";
        static BODY_MODE_FORMDATA = "formdata";
        static BODY_MODE_URLENCODED = "urlencoded";
        static BODY_MODE_RAW = "raw";
        static BODY_MODE_FILE = "file";
        static BODY_MODE_BINARY = "binary";
        static BODY_MODE_GRAPHQL = "graphql";
        static BODY_LANG_TEXT = "text";
        static BODY_LANG_JAVASCRIPT = "javascript";
        static BODY_LANG_JSON = "json";
        static BODY_LANG_XML = "xml";
        static BODY_LANG_HTML = "html";
        static BODY_LANG_GRAPHQL = "graphql";

        constructor(request) {
            if (pm.environment.name == undefined) {
                throw new SystemError(`请先选择环境变量配置`);
            }
            // defineReadOnly(this, "_request", request, false);
            this._request = request;
            this.C = this.constructor;
            this.rinfo = pm.info;
            this.method = this._request.method;
            this.body = this._request.body;
            this.isRequestScript = this.rinfo.eventName === "prerequest";
            this.isTestScript = !this.isRequestScript;
            this.isGet = this.method === "GET";
            this.isPost = this.method === "POST";
            this.isFormStyle = (this._request.url && Boolean(this._request.url.query));
            if (this.body) {
                const mode = this.body && this.body.mode, C = this.C;;
                this.mode = mode;
                this.isNoneBodyStyle = !Boolean(mode);
                this.isFormDataStyle = mode === C.BODY_MODE_FORMDATA;
                this.isUrlEncodedFormStyle = mode === C.BODY_MODE_URLENCODED;
                this.isFormBodyStyle = this.isFormDataStyle || this.isUrlEncodedFormStyle;
                this.isRawStyle = mode === C.BODY_MODE_RAW;
                this.isBinaryStyle = [C.BODY_MODE_BINARY, C.BODY_MODE_FILE].includes(mode);
                this.isGraphQLStyle = mode === C.BODY_MODE_GRAPHQL;
                this.isFormStyle = this.isFormBodyStyle || (this.isNoneBodyStyle && this.isFormStyle);
                if (this.isRawStyle) {
                    this.lang = this.body.options ? this.body.options.raw.language : C.BODY_LANG_TEXT;
                    this.isJsonStyle = this.lang === C.BODY_LANG_JSON;
                }
            }
            this.auth = this._request.auth;
            if (this.auth) {
                this.authType = this.auth.type;
            }
            this.headers = this._request.headers;
        }

        get params() { return this._request.url.query; }
        get data() { return this.mode ? this.body[this.mode] : null; }
        get formData() {
            return this.isFormBodyStyle
                ? this.data
                : this.isNoneBodyStyle
                    ? this.params
                    : null;
        }

        get std_params() { return this._std_params =
            this._std_params || this.filterEnabled(this._request.url.query); }
        get std_headers() { return this._std_headers =
            this._std_headers || this.filterEnabled(this._request.headers); }
        get std_cookies() { return this._std_cookies =
            this._std_cookies || this.filterEnabled(pm.cookies); }
        get std_data() {  return this._std_data =
            this._std_data !== undefined ? this._std_data : this.__std_data; }

        get __std_data() {
            if (this.isNoneBodyStyle) {
                return "";
            }
            const data = this.body[this.mode];
            // tips: 特殊的：显式无请求体类型返回空字符串，表单类型返回元素列表，steam类型返回文件名，graphql类型返回查询体。
            // tips: 判断是否真正具有请求体应当使用 this.std_hasBody 属性
            return this.isFormBodyStyle
                ? this.filterEnabled(data)
                : this.isBinaryStyle
                    ? data.src || ""    // tips: 貌似src这个属性不太稳定，碰到过未选择文件，但没有src属性的情况，原因不明
                    : this.isGraphQLStyle
                        ? data.query || ""
                        : data;
        }

        get std_auth() {
            // tips: 判断是否真正具有授权体应当使用 this.std_hasAuth 属性
            return this._std_auth = this._std_auth !== undefined
                ? this._std_auth
                : this.authType
                    ? this.filterEnabled(this._request.auth[this.authType])
                    : new sdk.PropertyList(sdk.Variable, {}, []);
        }

        get std_hasBody() {
            return this._std_hasBody = this._std_hasBody !== undefined
                ? this._std_hasBody
                : this.isFormBodyStyle
                    // tips: 尽管filter()过后sdk.PropertyList.isPropertyList(obj) === false，但其实仍继承了count()方法
                    ? this.std_data.count() > 0
                    : this.std_data !== "";
        }

        get std_hasAuth() {
            return this._std_hasAuth = this._std_hasAuth !== undefined
                ? this._std_hasAuth
                : this.authType
                    ? this.std_auth.count() > 0
                    : false;
        }

        filterEnabled(formdata) {
            // tips: 注意 NOTE:4 所提及的点
            // if (!sdk.PropertyList.isPropertyList(formdata)) {
            //     throw new SystemError;
            // }
            // return new sdk.PropertyList(formdata.Type, formdata.__parent || {},
            //     formdata.filter(field => !field.disabled));
            return formdata.filter(property => !property.disabled);
        }

        // for '/extra'
        updateBody(data) {
            pm.request.update({
                body: {
                    mode: this.mode,
                    raw: data,
                    options: this.body.options
                }
            })
        }

        static createFinalParamInterface() {
            const finalParams = new _Parameters(pm.request);
            return interfaces.addInterface(["params", {
                body_is_form: finalParams.isFormBodyStyle,
                body_is_binary: finalParams.isBinaryStyle,
                body_is_text: finalParams.isRawStyle || finalParams.isGraphQLStyle,
                body_is_json: finalParams.isJsonStyle || finalParams.isGraphQLStyle,
                _body_is_formdata: finalParams.isFormDataStyle,
                _body_is_graphql: finalParams.isGraphQLStyle,
                get has_auth() { return this._hasAuth =
                    this._hasAuth !== undefined ? this._hasAuth : finalParams.std_hasAuth; },
                get has_body() { return this._hasBody =
                    this._hasBody !== undefined ? this._hasBody : finalParams.std_hasBody; },
                get std_params() { return this._std_params =
                    this._std_params || utils.resolve2PropertyList(finalParams.std_params, sdk.QueryParam); },
                get std_headers() { return this._std_headers =
                    this._std_headers || utils.resolve2PropertyList(finalParams.std_headers, sdk.Header); },
                get std_cookies() { return this._std_cookies =
                    this._std_cookies || utils.resolve2PropertyList(finalParams.std_cookies, sdk.Cookie); },
                get std_auth() { return this._std_auth =
                    this._std_auth || utils.resolve2PropertyList(finalParams.std_auth, sdk.Variable); },
                get std_data() { return this._std_data = this._std_data !== undefined
                    ? this._std_data
                    : this.body_is_form
                        ? utils.resolve2PropertyList(finalParams.std_data, (this._body_is_formdata
                            ? sdk.FormParam
                            : sdk.QueryParam))
                        : this.body_is_text
                            ? utils.resolveScalar(finalParams.std_data)
                            : finalParams.std_data; },
                get query() { return this.params; },
                get params() { return this._params = this._params || this.std_params.toObject(); },
                get headers() { return this._headers = this._headers || this.std_headers.toObject(); },
                get cookies() { return this._cookies = this._cookies || this.std_cookies.toObject(); },
                get auth() { return this._auth = this._auth || this.std_auth.toObject(); },
                get data() { return this._data = this._data !== undefined ? this._data : this.__data; },
                get __data() {
                    if (this.body_is_form) {
                        return this.std_data.toObject();
                    }
                    if (this.body_is_json) {
                        if (this._body_is_graphql) {
                            return {
                                query: this.std_data
                            };
                        }
                        try {
                            const data = JSON.parse(this.std_data);
                            if ([true, false, null].includes(data)) {
                                throw new SystemError(`单字符串："null"、 "true"、 "false" 将不被认为是有效的JSON`);
                            }
                            return data;
                        } catch(e) {
                            throw new SystemError(e, this.std_data).withLabel(`请求体不是有效的JSON`);
                        }
                    }
                    return this.std_data;
                }
            }]);
        }
    }(pm.request);

    const interfaces = new class _Interfaces {
        static createInterfaceObject(name, innerTarget, overrideAttrs=null, missedGetter=null) {
            const fullTarget = Object.setPrototypeOf(overrideAttrs || {}, innerTarget);
            const apiKeys = Array.from((function(keySet) {
                for (let k in fullTarget) {
                    if (typeof k !== "symbol" && !/^[0-9_]/.test(k)) {
                        keySet.add(k);
                    }
                }
                return keySet;
            })(new Set()));
            return new Proxy({ _name: name, _keys: apiKeys,
                _obj: fullTarget, _missed: missedGetter }, {
                _attrcache: new Set(),
                _desccache: new Map(),
                _getDescriptor: function(initobj, attr) {
                    for (var _obj = initobj, descriptor; !descriptor; (_obj = _obj.__proto__)) {
                        descriptor = Object.getOwnPropertyDescriptor(_obj, attr);
                        if (descriptor
                                || !_obj.__proto__
                                || Object.getOwnPropertyDescriptor(_obj, "__lookupGetter__")) {
                            return descriptor;
                        }
                    }
                },

                get: function(target, attr, receiver) {
                    if (this._attrcache.has(attr)) {
                        return Reflect.get(target._obj, attr, target._obj);
                    }
                    if (!target._keys.includes(attr)) {
                        // tips: 避免打印 Proxy 对象时报错
                        if (attr === "toJSON") return {};
                        if (attr === "type") return "[object InterfaceObject]";
                        // tips:在 Promise 中，某些时候会自动检测 fullfilled 对象是否为 thenable 对象
                        // https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Promise/resolve
                        if (attr === "then") return undefined;
                        if (attr in target._obj) {
                            this._attrcache.add(attr);
                            return Reflect.get(target._obj, attr, target._obj);
                        }
                        if (target._missed) {
                            const defval = target._missed.call(this, target, attr, receiver);
                            if (defval !== undefined) { return defval; }
                        }
                        throw new SystemError(`Interface 对象 ${target._name} 没有该属性：【${attr}】。已开放的属性列表：${target._keys}`);
                    }
                    this._attrcache.add(attr);
                    return Reflect.get(target._obj, attr, target._obj);
                },
                set: function(target, attr, value) { return false; },
                has: function(target, attr) { return target._keys.includes(attr); },
                ownKeys: function(target) { return target._keys; },
                defineProperty: function(target, attr, descriptor) { return false; },
                deleteProperty: function(target, attr) { return false; },
                isExtensible: function(target) { return false; },
                preventExtensions: function(target) { return false; },
                getPrototypeOf: function(target) { return null; },
                setPrototypeOf: function(target, proto) { return false; },
                getOwnPropertyDescriptor: function(target, attr) {
                    if (!target._keys.includes(attr)) {
                        return undefined;
                    }
                    const descriptor = this._desccache.has(attr)
                        ? this._desccache.get(attr)
                        : this._getDescriptor(target._obj, attr);
                    descriptor
                        && this._desccache.set(attr)
                        && descriptor.writable
                        && (descriptor.writable = false);
                    return descriptor;
                }
            });
        }

        addInterface(objOrArray) {
            if (Array.isArray(objOrArray)) {
                var [name, innerTarget, overrideAttrs, missedGetter] = objOrArray;
            } else {
                var {name, innerTarget, overrideAttrs, missedGetter} = objOrArray;
            }
            const create = this.constructor.createInterfaceObject;
            return this[name] = create(name, innerTarget, overrideAttrs, missedGetter);
        }
    };

    const $$ = new Proxy({
        // tips: 兼容打印<Proxy>
        // toJSON: function() {
        //     const thisCopy = Object.assign({}, this);
        //     delete thisCopy.toJSON();
        //     return thisCopy;
        // }
    }, new class _Internal {
        static _fileNames = {
            "postman.settings": "Config",
            "postman.signers": "Signer",
            "postman.vars": "Var",
            "postman.docs": "Doc",
            "postman.intls": "Intl"
        };

        static _objectNames = {
            "config": "Config",
            "signer": "Signer",
            "sysvar": "Var",
            "doc": "Doc",
        }

        static _utils = new class _Utils {
            // tips: 移除JSON中的js型注释，包括块注释、行注释、行中注释、行尾注释，json是指格式化后的json
            removeJsonComments(json) {
                const _removeRestInlineComments = (text) => {
                    const info = {
                        isCommentContext: false
                    };
                    let pattern = /(?<id>(?<!\\)"|\/\*|\/\/)/g;
                    // tips: 使用 RegExp.exec() 执行全局搜索，应将正则单独定义一个变量，否则容易掉进死循环陷阱
                    for (let match; (match = pattern.exec(text)) !== null; ){
                        const id = match.groups.id;
                        if (id === '"') {
                            info.isCommentContext = !info.isCommentContext;
                            continue;
                        }
                        if (id === "/*") {
                            if (info.isCommentContext) {
                                continue;
                            }
                            const leftContext = RegExp.leftContext,
                                rightContext = RegExp.rightContext,
                                rest = rightContext.replace(/.*?\*\//, "");
                            return leftContext + _removeRestInlineComments(rest);

                        }
                        if (id === "//") {
                            if (info.isCommentContext) {
                                continue;
                            }
                            const leftContext = RegExp.leftContext,
                                rightContext = RegExp.rightContext,
                                rest = rightContext.replace(/.*/, "");
                            return leftContext + _removeRestInlineComments(rest);
                        }
                    }
                    return text;
                };

                return json.match(/.*/gm).reduce((info, line, index) => {
                    const pline = line.trim();
                    if (!pline || info.isCommentContext) {
                        if (pline.includes("*/")) {
                            line = line.replace(/.*\*\//, "");
                            info.isCommentContext = false;
                        }
                        return info;
                    }
                    if (pline.startsWith("/*")) {
                        info.isCommentContext = true;
                        return info;
                    }
                    if (pline.startsWith("//")) {
                        return info;
                    }
                    if (pline.includes("//") || pline.includes("/*")) {
                        line = _removeRestInlineComments(line);
                    }
                    info.result += ((index === 0 ? "" : "\n") + line);
                    return info;
                }, {
                    isCommentContext: false,
                    result: ""
                }).result;
            }
        };

        constructor() {
            const C = this.C = this.constructor;
            const P = this.P = parameters;
            const reqName = P.rinfo.requestName.toLowerCase();
            if (C._fileNames.hasOwnProperty(reqName)) {
                this._loadClass(C._fileNames[reqName], reqName);
                log.emit();     // don't forget to emit log messages
                throw new CancelSignal(`初始化${reqName}配置`);
            }
        }

        get(target, attr, reciever) {
            if (target[attr]) {
                return target[attr];
            }
            if (attr === "utils") {
                return target[attr] = this.C._utils;
            }
            if (this.C._objectNames.hasOwnProperty(attr)) {
                return target[attr] = this._loadClass(this.C._objectNames[attr], null);
            }
            throw new SystemError;
        }

        _loadClass(clsName, fileName=null) {
            const cls = this.C[clsName], [mode, lang] = cls.DEFINITION_CONTEXT;
            const thisMode = this.P.mode, thisLang = this.P.lang;
            if (fileName) {
                if (!(thisMode === mode && thisLang === lang)) {
                    throw new SystemError(`【${fileName}】配置必须使用 ${mode}+${lang} 模式定义：${thisMode}+${thisLang}`);
                }
                return Object.freeze(new cls(this.P.data || "", true, this));
            } else {
                const variable = cls.BIND_TO_VARIABLE;
                const data = pm.environment.get(variable) || "";
                return Object.freeze(new cls(data, false, this));
            }
        }

        _commonSave(instance, data) {
            const variable = instance.constructor.BIND_TO_VARIABLE;
            const backupVariable = instance.constructor.BACKUP_TO_VARIABLE;
            const previousData = pm.environment.get(variable);
            pm.environment.set(variable, data);
            if (previousData && data !== previousData) {
                pm.environment.set(backupVariable, previousData);
            }
            return true;
        }

        _commonLoad(...args) {
            return true;
        }

        static Config = class _Config {
            static DEFINITION_CONTEXT = ["raw", "json"];
            static BIND_TO_VARIABLE = "__postman.settings__";
            static BACKUP_TO_VARIABLE = "__postman.settings.backup__";

            constructor(data, isSetup, container) {
                this.data = data || `{"config": {}}`;
                this.container = container;
                isSetup
                    ? this.beforeSaveAndLoad(isSetup) && this.container._commonSave(this, JSON.stringify(this.data))
                    : this.beforeSaveAndLoad(isSetup) && this.container._commonLoad();
            }

            beforeSaveAndLoad(isSetup) {
                try {
                    if (/\{\{(?<tokenName>[^{}]*?)\}\}/.test(this.data)) {
                        throw new SystemError(`配置不应包含任何变量引用：【\{\{${RegExp.$1}\}\}】`);
                    }
                    if (isSetup) {
                        this.data = this.container.C._utils.removeJsonComments(this.data);
                    }
                    const data = this.data = JSON.parse(this.data);
                    if (!(_.isPlainObject(data) && data.hasOwnProperty("config") && _.isPlainObject(data.config))) {
                        throw new SystemError(`配置结构应为：{"config": { ... }}`);
                    }
                    return true;
                } catch(e) {
                    throw new SystemError(e).withLabel(`settings配置初始化/加载失败`);
                }
            }

            _check(type, data) {
                if (data == null) {
                    return true;
                }
                switch (true) {
                    case Object.is(Object, type):
                        return _.isPlainObject(data);
                    case Object.is(Array, type):
                        return Array.isArray(data);
                    case Object.is(Number, type):
                        return !isNaN(data) && typeof data === "number";
                    case Object.is(String, type):
                        return typeof data === "string";
                    case Object.is(Boolean, type):
                        // tips: boolean类型保持严格定义，即 0、1 不算boolea类型
                        return typeof data === "boolean";
                    case Object.is(null, type):
                        return data === null;
                    default:
                        throw new SystemError;
                }
            }

            get(dataType, configPath, overrides=null, defaults=Symbol) {
                if (arguments.length < 2 || _.isString(dataType)) {
                    throw new SystemError(`config.get()：至少需要两个参数，示例：config.get(String, "name.to.path")`);
                }
                const label = `获取settings配置【${configPath}】`;
                const value = configPath.split(".").reduce(function(obj, property, index, parts) {
                    let lastIndex = parts.length - 1;
                    if (index === lastIndex) {
                        if (obj.hasOwnProperty(property)) {
                            // if (_.isPlainObject(obj[property])) {
                            //     throw new SystemError(`获取配置：访问的配置不是终值类型 ${configPath}`);
                            // }
                            let attr = obj[property];
                            if ([null, undefined].includes(attr)
                                || (Array.isArray(attr) && attr.length === 0)
                                || (_.isPlainObject(attr) && Object.keys(attr).length === 0)) {
                                log.warn(`${label}：配置值为空`, {value: attr});
                            }
                            log.debug(label, {value: attr});
                            var result = attr;
                        } else
                        if (overrides == null) {
                            if (Object.is(Symbol, defaults)) {
                                throw new SystemError(`获取失败，没有该项配置`).withLabel(label);
                            }
                            log.debug(`${label}：获取失败，但指定了默认值，从默认值中读取`, {value: defaults});
                            var result = defaults;
                        } else {
                            log.debug(`${label}：获取失败，但指定了替代值，从替代值中读取`, {value:overrides});
                            var result = overrides;
                        }
                        if (!this._check(dataType, result)) {
                            throw new SystemError(`数据类型【${utils.getType(result)}】与目标类型【[object ${dataType ? dataType.name : "Null"}]}】不一致`).withLabel(label);
                        }
                        return result;
                    }
                    if (!obj.hasOwnProperty(property)) {
                        return {};
                    }
                    if (!_.isPlainObject(obj[property])) {
                        throw new SystemError(`访问的配置属性不是对象类型：【${property}】`).withLabel(label);
                    }
                    return obj[property];
                }.bind(this), this.data.config);
                return (value && typeof value === "object") ? Object.freeze(value) : value;
            }

            reInitLogLevel() {
                // || "warn": 可以在无法正确获取log配置时也给出一个错误提示
                log.setLevel(this.get(String, "local.logs.defaultLevel", "warn"));
                return this;
            }
        };

        static _commonFunctionRegister = class {
            /**
             * @signatures: <Array[<Array[<String#ParamList>]>, <Int#funcType>]>
             *   @funcType:
             *     0 => both async and sync
             *     1 => sync only
             *     2 =》 async only
             */
            constructor(name, desc, signatures) {
                this.name = name;
                this.desc = desc;
                this.signatures = signatures;
            }

            set(target, attr, value) {
                const type = Object.prototype.toString.call(value),
                    isSyncFunction = type === "[object Function]",
                    isAsyncFunction = type === "[object AsyncFunction]";
                if (!isSyncFunction && !isAsyncFunction) {
                    throw new SystemError(`每个${this.desc}必须是一个普通函数或异步函数：【${this.name}.${attr}】 => ${type}`);
                }
                if (target.hasOwnProperty(attr)) {
                    throw new SystemError(`${this.desc}已经存在：【${this.name}.${attr}】`);
                }
                if (!/^[a-zA-Z][a-z_A-Z0-9]*$/.test(attr)) {
                    throw new SystemError(`${this.desc}名称不规范，必须仅由字母、数字及下划线组成，且必须以字母开头：【${this.name}.${attr}】`);
                }
                const match = /^(async\s+)?function\s*\((?<arglist>.*?)\)/.exec(value.toString());
                const signatures = match.groups.arglist.split(/\s*,\s*/).join(",");
                if (this.signatures.every(function([sigs]) { return sigs !== signatures; }, this)) {
                    const suffix = this.signatures.reduce((text, [sigs, type]) => {
                        if (type === 0 || type === 1) {
                            text += (`\n${" ".repeat(6)}${this.name}.${attr} = function(${sigs.replace(",", ", ")}) { .... }`);
                        }
                        if (type === 0 || type === 2) {
                            text += (`\n${" ".repeat(6)}${this.name}.${attr} = async function(${sigs.replace(",", ", ")}) { .... }`);
                        }
                        return text;
                    }, "") + "\n";
                    throw new SystemError(`形参签名错误：【${this.name}.${attr}】。规范的定义：${suffix}`);
                }
                value.isSync = isSyncFunction;
                target[attr] = value;
                return true;
            }
        };

        static _commonFunctionalClass = class {
            constructor(data, isSetUp, container, _name, _desc, _register) {
                this._name = _name;
                this._desc = _desc;
                this._register = _register;

                this.data = data || "{}";
                this.container = container;
                isSetUp
                    ? this.beforeSave() && this.save()
                    : this.beforeLoad() && this.load();
            }

            get commonApis() {
                if (this._commonApis) { return this._commonApis; }
                // tips: utils对象的方法相对不稳定，因此只开放相对稳定的方法
                const utility = interfaces.addInterface(["utils", {
                    sendRequest: utils.sendRequest.bind(utils),
                    getList: utils.getList.bind(utils)
                }]);
                return this._commonApis = {
                    SystemError: SystemError,
                    log: log,
                    libs: libs,
                    config: config,
                    utils: utility,
                    CryptoJS: CryptoJS,
                    console: console,
                    pm: pm,
                    _: _
                };
            }

            beforeSave() {
                try {
                    const scopeFn = new Function('code', this._name, 'return eval(code);');
                    scopeFn.call(null, this.data, this._register);
                    return true;
                } catch(e) {
                    throw new SystemError(e).withLabel(`${this._desc}注册/定义错误`);
                }
            }

            save() {
                const data = Object.entries(this._register).reduce((data, [name, method]) => {
                    return data[name] = method.toString(), data;
                }, {})
                this.container._commonSave(this, JSON.stringify(data));
                this.data = this._register;
                return true;
            }

            beforeLoad() {
                try {
                    const data = JSON.parse(this.data);
                    const type = Object.prototype.toString.call(data);
                    if (type !== "[object Object]") {
                        throw new SystemError;
                    }
                    const apis = Object.assign(Object.create(this.commonApis, {}), this.APIS || {});
                    const [apiNameList, apiList] = [[], []];
                    // tips: 使用 for ... in 遍历私有属性和原型链中的属性，且去重
                    for (let attr in apis) {
                        apiNameList.push(attr); apiList.push(apis[attr]);
                    }
                    const scopeFn = new Function(
                        // tips: 不书写完整参数列表：不暴露非api变量。真实参数签名：(name, body, register, apiVariables)。另外的原因：delete 函数体内的变量并不能删除变量定义，而即使赋值为 undefined 也同样不能删除变量定义
                        'name',
                        // tips: 不能直接赋值，因为 body 是字符串
                        'eval(`arguments[2][name] = ${arguments[1]}`);'
                        // tips: API变量
                      + `const [${apiNameList}] = arguments[3];`);
                    Object.getOwnPropertyNames(data).forEach(function(attr) {
                        scopeFn.call(null, attr, data[attr], this._register, apiList);
                    }, this);
                    return true;
                } catch(e) {
                    throw new SystemError(e).withLabel(`${this._desc}注册/加载错误，请重新初始化配置`);
                }
            }

            load() {
                this.data = this._register;
                return true;
            }
        };

        static _SignerRegister = new Proxy({}, new _Internal._commonFunctionRegister("signer", "签名函数", [["params", 0]]));

        static Signer = class _Signer extends _Internal._commonFunctionalClass {
            static DEFINITION_CONTEXT = ["raw", "javascript"];
            static BIND_TO_VARIABLE = "__postman.signers__";
            static BACKUP_TO_VARIABLE = "__postman.signers.backup__";

            constructor(data, isSetUp, container) {
                super(data, isSetUp, container, "signer", "签名函数", container.C._SignerRegister);
            }

            /**
             * @tips: 内部约定属性，该属性返回的API对象与公共API对象合并后对外提供
             */
            get APIS() {
                var profileGetter = () => {
                    if (typeof handlers == undefined) {
                        throw new SystemError;
                    }
                    const findex = handlers.featuresIndexMap.get("signer");
                    const fone = handlers.featuresList[findex][0];
                    return fone.getServiceProfile();
                }
                const SignerExecutor = class extends Executor {
                    constructor(lang, cfg=null) {
                        _.isFunction(profileGetter) && (profileGetter = profileGetter());
                        super(lang, Object.assign({ profile: profileGetter }, cfg || {}), "signer");
                    }
                };
                return {
                    SignerExecutor: SignerExecutor
                };
            }

            get list() {
                return Object.getOwnPropertyNames(this.data);
            }
        };

        static _VarRegister = new Proxy({}, new _Internal._commonFunctionRegister("sysvar", "系统变量函数", [["", 0]]));

        static Var = class _Var extends _Internal._commonFunctionalClass {
            static DEFINITION_CONTEXT = ["raw", "javascript"];
            static BIND_TO_VARIABLE = "__postman.vars__";
            static BACKUP_TO_VARIABLE = "__postman.vars.backup__";

            constructor(data, isSetUp, container) {
                super(data, isSetUp, container, "sysvar", "系统函数变量", container.C._VarRegister);
            }

            get APIS() {
                const createProxyObject = function(mode, handler) {
                    const t1 = Object.prototype.toString.call(mode),
                        isArrayMode = t1 === '[object Array]',
                        isFunctionMode = t1 === '[object Function]',
                        t2 = Object.prototype.toString.call(handler),
                        isSyncFunction = t2 === '[object Function]',
                        isAsyncFunction = t2 === '[object AsyncFunction]';
                    if (!isArrayMode && !isFunctionMode) {
                        throw new SystemError(`createProxyObject(mode, handler): @mode参数必须是一个常规的字符串数组或同步函数((attr) -> <Boolean>)`, t1);
                    }
                    if (!isSyncFunction && !isAsyncFunction) {
                        throw new SystemError(`createProxyObject(mode, handler): @handler参数必须是一个常规的同步函数或异步函数((attr) -> <Any>)`, t2);
                    }
                    return new Proxy({}, {
                        get: function(target, attr) {
                            if (typeof attr === "symbol" || attr === "then" /** 见 /_sysvar 中的 _chainsGetObj() */) {
                                return target[attr];
                            }
                            return handler.call(target, attr);
                        },

                        has: function(target, attr) {
                            if (isFunctionMode) {
                                const result = mode.call(target, attr);
                                const type = Object.prototype.toString.call(result);
                                if (type !== '[object Boolean]') {
                                    throw new SystemError(`createProxyObject(mode, handler): @mode参数为函数时必须返回<Boolean>类型`, type);
                                }
                                return result;
                            }
                            return mode.includes(attr);
                        }
                    });
                };
                const SysVarExecutor = class extends Executor {
                    constructor(lang, cfg=null) {
                        super(lang, cfg, "_sysvar");
                    }
                };
                return {
                    createProxyObject: createProxyObject,
                    SysVarExecutor: SysVarExecutor
                };
            }
        };

        static Doc = class _Doc {
            static DEFINITION_CONTEXT = ["raw", "html"];
            static BIND_TO_VARIABLE = "__postman.doc__";
            static BACKUP_TO_VARIABLE = "__postman.doc.backup__";

            constructor(data, isSetUp, container) {
                this.data = data || `<!DOCTYPE html>
<html>
    <body>
        <h6>No Doc !</h6>
    </body>
</html>`;
                this.container = container;
                isSetUp
                    ? this.beforeSaveAndLoad(isSetUp) && this.container._commonSave(this, this.data)
                    : this.beforeSaveAndLoad(isSetUp) && this.container._commonLoad();
            }

            beforeSaveAndLoad(isSetUp) {
                // ref: https://github.com/cheeriojs/cheerio
                let $ = libs.cheerio.load(this.data);
                // log.log("【/doc】content", $.html());
                if ($('html').has('body').length === 0) {
                    throw new SystemError(`初始化/加载HTML文档错误，约定HTML文档必须要有<html>标签和<body>标签`);
                }
                $ = null;
                isSetUp && pm.visualizer.set(this.data);
                return true;
            }
        };
    });

    const config = $$.config.reInitLogLevel();

    const _AESEncrypter = class {
        static _ensureUrlSafeBase64(stdBase64) {
            return stdBase64.replace(/[\+\/]|\=+/g, function(match) {
                return match === "+"
                    ? "-" : match === "/"
                    ? "_" : "";
            });
        }

        static _ensureStdBase64(urlSafeBase64) {
            let stdBase64 = urlSafeBase64.replace(/[-_]/g, function(match) {
                return match === "-" ?  "+" : "/";
            });
            while (stdBase64.length % 4) {
                stdBase64 += "=";
            }
            return stdBase64;
        }

        static _createIv(secret, nonceWordArray) {
            let keyIv = CryptoJS.PBKDF2(secret, nonceWordArray, {
                keySize: 512/32,
                iterations: 1000,
                hasher: CryptoJS.algo.SHA256
            }).toString(CryptoJS.enc.Hex);
            let key = keyIv.slice(0, 64),
                iv = keyIv.slice(63, 95),
                keyWordArray = CryptoJS.enc.Hex.parse(key),
                ivWordArray = CryptoJS.enc.Hex.parse(iv);
            return [keyWordArray, ivWordArray];
        }

        static _createFormatter(nonceWordArray, keyWordArray, ivWordArray) {
            let that = this;
            return {
                stringify: function(cipherParams) {
                    return that._ensureUrlSafeBase64(cipherParams.ciphertext
                        .concat(nonceWordArray)
                        .toString(CryptoJS.enc.Base64))
                },

                parse: function(cipherText) {
                    return CryptoJS.lib.CipherParams.create({
                        ciphertext: CryptoJS.enc.Base64
                            .parse(that._ensureStdBase64(cipherText)),
                        key: keyWordArray,
                        iv:  ivWordArray,
                        algorithm: CryptoJS.algo.AES,
                        padding: CryptoJS.pad.Pkcs7,
                        mode: CryptoJS.mode.CBC
                    });
                }
            };
        }

        static encrypt(secret, plainText) {
            let nonceWordArray = CryptoJS.lib.WordArray.random(8);
            let [keyWordArray, ivWordArray] = this._createIv(secret, nonceWordArray);
            return CryptoJS.AES.encrypt(plainText, keyWordArray, {
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7,
                iv: ivWordArray,
                format: this._createFormatter(nonceWordArray, keyWordArray, ivWordArray)
            }).toString();
        }
    };

    const SendResult = class {
        static REJECT_TYPE_CONNECT = 1;
        static REJECT_TYPE_OKSTATUS = 2;
        static REJECT_TYPE_STATUS = 3;
        static REJECT_TYPE_DATA = 4;
        static REJECT_TYPE_SYSTEM = 5;

        static _downedUrls = new Set();

        constructor(cfgMeta={}, resp=null, rejectType=null, reasonOrData=null) {
            defineReadOnly(this, "resp", resp, true);
            defineReadOnly(this, "cfg", cfgMeta, true);
            defineReadOnly(this, "rejectType", rejectType, false);
            const _data = reasonOrData instanceof SystemError
                ? reasonOrData.withLabel(this.cfg.url ? `请求失败："${this.cfg.url}"` : "")
                : reasonOrData;
            defineReadOnly(this, "_data", _data, false);

            if (rejectType) {
                this.constructor._downedUrls.add(this.cfg.url);
            }
        }

        get data() {
            return this.rejectType == null ? this._data : null;;
        }

        /**
         * @return: <Error>
         */
        get reason() {
            return this.rejectType ? this._data : null;
        }
    };

    const utils = new class _Utils {
        getType(obj) {
            return Object.prototype.toString.call(obj);
        }

        getVariable(name) {
            return pm.variables.get(name);
        }

        /**
         * examples:
         *  getVariableTokens(`{{}}{{}}`, false, false) -> [""]                       // duplicated removed
         *  getVariableTokens(`{{  }}`, true, false) -> []                            // all blank tokens ignored
         *  getVariableTokens(`{{}}{{}}`), false, true) -> [["", 0, 2], ["", 8, 2]]   // all non-blank tokens returned
         */
        getVariableTokens(value, strict=false, indexInfo=false) {
            if (!_.isString(value) || !value.trim()) {
                return [];
            }
                // tips: \postman-collection\lib\superstring\index.js\<Substitutor>.REGEX_EXTRACT_VARS
            let pattern = /\{\{(?<tokenName>[^{}]*?)}}/g;
            return [...value.matchAll(pattern)].reduce(function(arr, cur){
                let token = cur.groups.tokenName || "";     // tips: EXPR {{}} is accepted
                if (strict && !token.trim()) {
                    return arr;
                }
                !arr.includes(token) && arr.push(indexInfo ? [
                    token,
                    cur.index,
                    cur.length
                ] : token);
                return arr;
            }, []);
        }

        hasToken(value) {
            return this.getVariableTokens(value, false, false).length > 0;
        }

        setVariable(name, value) {
            pm.environment.set(name, value);
        }

        unsetVariable(name) {
            pm.environment.unset(name);
        }

        resolveScalar(scalar) {
            return sdk.Property.replaceSubstitutions(scalar, [
                postman.__execution._variables.values,
                postman.__execution.collectionVariables.values,
                postman.__execution.environment.values,
                postman.__execution.globals.values]);
        }

        resolveScalarIn(scalar, subIn) {
            return sdk.Property.replaceSubstitutions(scalar, subIn);
        }

        resolveObject(obj) {
            return sdk.Property.replaceSubstitutionsIn(obj, [
                postman.__execution._variables.values,
                postman.__execution.collectionVariables.values,
                postman.__execution.environment.values,
                postman.__execution.globals.values]);
        }

        resolveProperty(property) {
            return this.resolveObject(property);
        }

        resolvePropertyList(proplist, excludes=[]) {
            return proplist.map(function(property) {
                if (excludes.includes(property.key)) {
                    return property;
                }
                return this.resolveProperty(property);
            }, this);
        }

        resolve2PropertyList(proplist, constructor=null) {
            if (sdk.PropertyList.isPropertyList(proplist)) {
                constructor = proplist.Type;
                var parent = proplist.__parent;
            } else {
                if (typeof constructor !== "function") {
                    throw new SystemError;
                }
                var parent = {};
            }
            // tips: 注意 Note:4 中所提及的点
            return new sdk.PropertyList(constructor, parent, proplist.map(function(property) {
                return new constructor(this.resolveProperty(property));
            }, this));
        }

        /**
         * @url: <String>, variables is disallowed
         */
        getAllCookies(url) {
            if (this.hasToken(url)) {
                throw new SystemError;
            }
            return new Promise((resolve, reject) => {
                return pm.cookies.jar().getAll(url, (error, cookies) => {
                    if (error) {
                        return reject(new SystemError(error));
                    }
                    return resolve(cookies || new sdk.PropertyList(sdk.Cookie, {}, []));
                });
            });
        }

        /**
         * @url: <String>, variables is disallowed
         */
        setCookie(url, cookie) {
            if (this.hasToken(url)) {
                throw new SystemError;
            }
            return new Promise((resolve, reject) => {
                return pm.cookies.jar().set(url, cookie, function(error, cookie) {
                    if (error) {
                        reject(new SystemError(error));
                    }
                    resolve(cookie);
                });
            });
        }

        /**
         * @urlStr: <String>, required, without variable
         * @return: <sdk.Url>
         */
        toUrl(urlStr) {
            return new sdk.Url(sdk.Url.parse(urlStr));
        };

        /**
         * @url: <String>|<sdk.Url>, required, variable is allowed
         * @return: <sdk.Url>
         */
        toUrl2(url) {
            url = this.resolveScalar(url.toString());
            if (this.hasToken(url)) {
                throw new SystemError;
            }
            return new sdk.Url(sdk.Url.parse(url));
        }

        joinUrlPath(urlStr, pathStr) {
            return urlStr.replace(/\/*$/, pathStr.replace(/^\/*/, "/"));
        }

        /**
         * @raiseForEmpty: <Boolean>
         * @alternative: <String>|<sdk.Url>
         */
        getRemoteTarget(raiseForEmpty=true, alternative=null) {
            let url = (alternative || pm.request.url).toString();
            let tokensInfo = this.getVariableTokens(url, true, true);
            let [name, index, length] = (tokensInfo[0] || []);
            if (!tokensInfo.length || index !== 0) {
                if (raiseForEmpty) {
                    throw new SystemError(`请求地址中需要切换的主体部分须用变量表示(至少需要包含协议+域名+端口)：${url}`);
                }
                return null;
            }
            return name;
        }

        // removeBlankElements(arr, valueGetter=null) {
        //     return arr.reduceRight(function(src, e, i) {
        //         let value = valueGetter ? valueGetter(e) : e;
        //         if ([null, undefined, NaN, ""].includes(value) ||
        //             typeof value === "string" && !value.trim()) {
        //             src.splice(i, 1);
        //         }
        //         return src;
        //     }, arr);
        // }

        /**
         * @numExpr: <String>, check if a string is a valid number expression
         *  example:
         *      123             => int
         *      -1.23           => float
         *      0.023e2         => exponent notation
         *      -12.34E-2       => exponent notation
         * @raise: 'throw an error' or 'return false', if not a valid number expression
         */
        matchNumSpec(numExpr, raise=false) {
            let int_spec = /^-?[0-9]+$/,
                float_spec = /^-?[0-9]+\.[0-9]+$/,
                exponentSpec = /^-?[0-9]+(\.[0-9]+)?[eE][\+\-]?[0-9]+$/;
            if (int_spec.test(numExpr)) {
                if (numExpr.length > 1 && numExpr.startsWith("0")) {
                    if (!raise) return false;
                    throw new SystemError(`整型数值不能以 0 开头（0 除外）：${numExpr}`);
                }
                let number = Number(numExpr);
                if (!Number.isSafeInteger(number)) {
                    if (!raise) return false;
                    throw new SystemError(`无效的数值表达式，整数数值必须是Javascript安全整数：${numExpr}`);
                }
            } else if (float_spec.test(numExpr)) {
                if (/^0(?!\.)/.test(numExpr)) {
                    if (!raise) return false;
                    throw new SystemError(`浮点型数值表达式整数部分不能以 0 开头（0.xxx 除外）：${numExpr}`);
                }
                if (numExpr.length > 17) {
                    if (!raise) return false;
                    throw new SystemError(`太大/太小的浮点型数值表达式，要求(整数部分+小数部分)长度 ≤ 17：${numExpr}`);
                }
            } else if (exponentSpec.test(numExpr)) {
                let number = Number(numExpr);
                if ((Number.isInteger(number) && !Number.isSafeInteger(number)) || !Number.isFinite(number)) {
                    if (!raise) return false;
                    throw new SystemError(`太大/太小/无效的指数型数值表达式：${numExpr}`);
                }
            } else {
                if (!raise) return false;
                throw new SystemError(`无效的数值表达式：${numExpr}`);
            }
            return true;
        }

        randomBytes(length) {
            return CryptoJS.lib.WordArray.random(length);
        }

        randomId(bytesLength) {
            return this.randomBytes(bytesLength).toString(CryptoJS.enc.Hex);
        }

        /**
         * @min: <Integer>
         *  example: see this.matchNumSpec()
         * @max: <Integer>
         * @flagL: [ => left boundary inclusive; ( => left boundary exclusive
         * @flagR: ] => right boundary inclusive; ) => right boundary exclusive
         * @return: <Integer>
         */
        randomInt(min, max, flagL = "[", flagR = ")") {
            let calc = (minI, maxI) => {
                minI = flagL === "(" ? minI + 1 : minI;
                maxI = flagR === ")" ? maxI - 1 : maxI;
                return Math.floor(Math.random() * (maxI - minI + 1) + minI);
            };

            let rangeExpr = `${flagL}${min} - ${max}${flagR}`;
            let minN = Number(min), maxN = Number(max);
            if (minN > maxN) {
                throw new SystemError(`左边界大于右边界：${rangeExpr})`);
            }
            if ([minN, maxN].some(n => !Number.isInteger(n))) {
                throw new SystemError(`左右边界须均为整型：${rangeExpr}`);
            }
            for (var count = 0, result = calc(min, max);    // use 'var'
                (flagL === "(" && Number(result) === Number(min)) || (flagR === ")" && Number(result) === Number(max));     // don't use 'new' operator
                count++) {
                if (count > 0) {
                    throw new SystemError(`生成一个随机整型数字失败，请重试一次：${rangeExpr}`);
                }
                result = calc(min, max);
            }
            return result;
        }

        /**
         * @min: <Float>, also can be a string in one case: for 1.00, 1.10 etc. use "1.00", "1.10"
         *  example: see this.matchNumSpec()
         * @max: <Float>, also can be a string in one case: for 2.00, 2.20 etc. use "2.00", "2.20"
         * ....
         * @return: <String>
         */
        randomFloat(min, max, flagL = "[", flagR = ")") {
            let calc = (minI, maxI, maxLength) => {
                let result = Math.random() * (Number(maxI) - Number(minI)) + Number(minI);
                return result.toFixed(maxLength);   // typeof (n).toFixed() == "string"
            };

            let maxLength = 1, rangeExpr = `${flagL}${min} - ${max}${flagR}`;
            if ([min, max].some(n => typeof n === "string" && !/\.[0-9]*0$/.test(n))) {
                throw new SystemError;
            }
            if ([min, max].some(n => {
                let sn = n.valueOf().toString();
                if (/-?([0-9]+)(\.[0-9]+)?[eE]([\+\-]?[0-9]+)/.test(sn)) {
                    let i = RegExp.$1, p = RegExp.$2 || 0, e = Number(RegExp.$3);
                    let thisLength = e >= 0 ? p.length - e : Math.abs(e + i.length) + i.length + p.length;
                    thisLength > maxLength && (maxLength = thisLength);
                    return thisLength > 17;
                } else {
                    let r = sn.match(/(?<=\.)[0-9]+$/);
                    let thisLength = r && r[0].length || 1;
                    thisLength > maxLength && (maxLength = thisLength);
                    return thisLength > 17;
                }
            })) {
                throw new SystemError(`边界精度超出限制范围：${rangeExpr}`);
            }
            if ([min, max].every(n => Number.isInteger(n))) {
                throw new SystemError(`须至少指定一个浮点型边界：${rangeExpr}`);
            }
            if (Number(min) > Number(max)) {
                throw new SystemError(`左边界大于右边界的值：${rangeExpr}`);
            }
            for (var count = 0, result = calc(min, max, maxLength);    // use 'var'
                (flagL === "(" && Number(result) === Number(min)) || (flagR === ")" && Number(result) === Number(max));
                count++) {
                if (count > 1) {
                    throw new SystemError(`生成一个随机浮点型数字失败，请重试一次：${rangeExpr}`);
                }
                result = calc(min, max);
            }
            return result;
        }

        /**
         * @min: <Integer|Float|String>，this param can be a range expression,
         *  in this case, other parameters are omitted, and the default right flag become "]", not ")"
         * ....
         * @return: <String>
         *
         * see also: this.randomInt() and this.randomFloat() and this.matchNumSpec()
         */
        // @bugs: 例如 999.99-1000, 期望结果是 1000.00，但实际结果有时是 1000，有时是 1000.00
        randomNumber(min, max, flagL = "[", flagR = ")") {
            if (arguments.length === 1 && typeof arguments[0] === "string") {
                let pattern = /^(?<flagL>[\[\(])?\s*(?<minN>-?[0-9\.]+([eE][\+\-]?[0-9]+)?)\s*-\s*(?<maxN>-?[0-9\.]+([eE][\+\-]?[0-9]+)?)\s*(?<flagR>[\]\)])?$/;
                let expr = min, r = expr.match(pattern);
                if (!r) {
                    throw new SystemError(`无效的数字区间型表达式: "${arguments[0]}"`);
                }
                let { minN, maxN } = r.groups;
                this.matchNumSpec(minN, true) && this.matchNumSpec(maxN, true);
                [min, max] = [minN, maxN].map(n => /\.[0-9]*0$/.test(n) ? n : Number(n));
                flagL = r.groups.flagL || "[",
                    flagR = r.groups.flagR || "]";
            }

            let result = [min, max].every(n => Number.isInteger(n))
                ? utils.randomInt(min, max, flagL, flagR)
                : utils.randomFloat(min, max, flagL, flagR);
            return result.toString();       // return a string for consistency
        }

        randomList(list) {
            if (list.length === 0) {
                return list;
            }
            let index = utils.randomInt(0, list.length, "[", ")");
            return list[index];
        }

        correctUndefinedIndexes(obj, _depth=0) {
            let callee = utils.correctUndefinedIndexes;
            if (Array.isArray(obj)) {
                obj = Object.values(obj);
                return obj.reduce(function(acc, ele, idx, src) {
                    if (Array.isArray(ele)) {
                        src[idx] = callee(ele, _depth + 1);
                    } else {
                        callee(ele, _depth + 1);
                    }
                    return acc;
                }, obj);
            } else
            if (_.isPlainObject(obj)) {
                let keys = Object.keys(obj);
                for (let key of keys) {
                    if (Array.isArray(obj[key])) {
                        obj[key] = callee(obj[key], _depth + 1);
                    } else {
                        callee(obj[key], _depth + 1);
                    }
                }
            }
            if (_depth === 0) {
                return obj;
            }
        }

        isAsciiPunct(char) {
            let codePoint = char.codePointAt(0);
            return (33 <= codePoint && codePoint <= 47) ||
                (58 <= codePoint && codePoint <= 64) ||
                (91 <= codePoint && codePoint <= 94) ||
                (codePoint === 96) ||
                (123 <= codePoint && codePoint <= 126);
        }

        /**
         * @return <Array>
         * #Positive
         * getList("abc") => ["abc"]
         * getList("abc,,, def") => ["abc", "def"]
         * getList("%abc % def") => ["abc", "def"]
         * getList("abc,abc", true)  => ["abc"]
         * getList("abc,abc", false) => ["abc", "abc"]
         * getList("()") => [""]        // TODO 删除这种表达方式，重新设计表达方式
         * getList("(32)") => [" "]     // TODO 删除这种不直观且不够准确的表达方式，重新设计表达方式
         *
         * #Nagative
         * getList() => []
         * getList(123) => []
         * getList("") => []
         * getList(",") => []
         * getList("({{NAME}})") => "({{NAME}})"    // no change
         */
        getList(expr, unique=false, excludedSepList=[]) {
            if (!_.isString(expr) || !expr.trim()) {
                return [];
            }
            let char = expr[0],
                is = this.isAsciiPunct(char) && !excludedSepList.includes(char),
                separator = is ? char : /[,，]/;
            let parts = (is ? expr.substring(1) : expr).split(separator);
            const list = parts.reduceRight(function(_nil, cur, idx, src) {
                src[idx] = cur.trim();
                if (!src[idx]) {
                    src.splice(idx, 1);
                } else
                if (/^\(([0-9]*)\)$/.test(src[idx])) {
                    // tips: enable "()" to be parsed as ""
                    // tips: enable "(32)" to be parsed as String.prototype.fromCodePoint(32)
                    // tips: "({{VARNAME}})" will not be parsed
                    src[idx] = RegExp.$1
                        ? String.prototype.fromCodePoint(Number(RegExp.$1))
                        : "";
                }
                return src;
            }, parts);
            return unique ? [...new Set(list)] : list;
        }

        isSuperset(set, subset) {
            for (let elem of subset) {
                if (!set.has(elem)) {
                    return false;
                }
            }
            return true;
        }

        setUnion(setA, setB) {
            let _union = new Set(setA);
            for (let elem of setB) {
                _union.add(elem);
            }
            return _union;
        }

        setIntersection(setA, setB) {
            let _intersection = new Set();
            for (let elem of setB) {
                if (setA.has(elem)) {
                    _intersection.add(elem);
                }
            }
            return _intersection;
        }

        setSymmetricDifference(setA, setB) {
            let _difference = new Set(setA);
            for (let elem of setB) {
                if (_difference.has(elem)) {
                    _difference.delete(elem);
                } else {
                    _difference.add(elem);
                }
            }
            return _difference;
        }

        setDifference(setA, setB) {
            let _difference = new Set(setA);
            for (let elem of setB) {
                _difference.delete(elem);
            }
            return _difference;
        }

        /**
         * @requester
         *  {
         *     url: <String>|<sdk.Url>                                          // inherit from pm.sendRequest()
         *     method: <String>                                                 // inherit from pm.sendRequest()
         *     header: <sdk.Header.definition>|<Array[<sdk.Header.definition>]> // inherit from pm.sendRequest()
         *     body: <sdk.RequestBody.definition>                               // inherit from pm.sendRequest()
         *     auth: <sdk.RequestAuth.definition>                               // inherit from pm.sendRequest()
         *     proxy: <sdk.ProxyConfig.definition>                              // inherit from pm.sendRequest()
         *     certificate: <sdk.Certificate.definition>                        // inherit from pm.sendRequest()
         *
         *     dataType: <String>                           // custom
         *     gracefulDown: <Boolean>                      // custom, 对于一开始就并发的请求（如：“/ping”），不会产生效果
         *     raiseForStatus: <Boolean>                    // custom
         *     ok: <Function(<sdk.Response>)> -> <Boolean>  // custom
         *     okFinal: <Function(<Object>)> -> <Boolean>   // custom
         * }
         *
         * @return <Promise> -> resolve(<SendResult>), reject(<SendResult>)
         */
        sendRequest(requester) {
            if (!_.isPlainObject(requester)) {
                requester = {};
            }
            if (requester.dataType && !["json", "jsonp", "text"].includes(requester.dataType)) {
                return Promise.reject(new SendResult(requester, null, SendResult.REJECT_TYPE_SYSTEM,
                    new SystemError(`请求配置错误：不支持的dataType类型：${requester.dataType}，支持配置的值列表：json,text,jsonp(暂不支持)`)));
            }
            requester = Object.assign({
                raiseForStatus: true,
                gracefulDown: false,
                dataType: null,
                ok: null
            }, requester);
            if (requester.gracefulDown) {
                // 对于一开始就并发的请求（如：“/ping”），不会产生效果
                if (SendResult._downedUrls.has(requester.url)) {
                    return Promise.reject(new SendResult(requester, null, SendResult.REJECT_TYPE_CONNECT,
                        new SystemError(`granceful down：${requester.url}`)));
                }
            }
            return new Promise((resolve, reject) => {
                log.debug(`开始发送请求`, requester);
                pm.sendRequest(requester, (error, response) => {
                    if (error) {
                        return reject(new SendResult(requester, null, SendResult.REJECT_TYPE_CONNECT,
                            new SystemError(error)));
                    }
                    /** tips:
                     * 200 - HTTP OK
                     * 201 - HTTP Created
                     * 202 - HTTP Accepted
                     */
                    if (![200, 201, 202].includes(response.code)) {
                        if (requester.raiseForStatus) {
                            return reject(new SendResult(requester, response, SendResult.REJECT_TYPE_STATUS,
                                new SystemError(`${response.reason()}（statusCcode=${response.code}）`)));
                        }
                    }
                    if (requester.ok) {
                        try {
                            if (requester.ok(response) !== true) {
                                return reject(new SendResult(requester, response, SendResult.REJECT_TYPE_OKSTATUS,
                                    new SystemError(`请求结果未通过"ok()"函数测试`)));
                            }
                        } catch(e) {
                            return reject(new SendResult(requester, response, SendResult.REJECT_TYPE_OKSTATUS,
                                new SystemError(e)));
                        }
                    }
                    if (requester.dataType) {
                        try {
                            var result = requester.dataType === "json"
                                ? response.json()
                                : requester.dataType === "jsonp"
                                    ? response.jsonp()
                                    : response.text();
                        } catch(e) {
                            return reject(new SendResult(requester, response, SendResult.REJECT_TYPE_DATA,
                                new SystemError(e)));
                        }
                        if (requester.okFinal) {
                            try {
                                if (requester.okFinal(result) !== true) {
                                    return reject(new SendResult(requester, response, SendResult.REJECT_TYPE_OKSTATUS,
                                        new SystemError(`请求结果未通过"okFinal()"函数测试`)));
                                }
                            } catch(e) {
                                return reject(new SendResult(requester, response, SendResult.REJECT_TYPE_OKSTATUS,
                                    new SystemError(e)));
                            }
                        }
                        return resolve(new SendResult(requester, response, null, result));
                    }
                    return resolve(new SendResult(requester, response, null, null));
                });
            });
        }
    };

    const env = new class _Envirenmont {
        constructor() {
            this._postTask_unInitializedVariables = [];
        }

        getVariable(...args) {
            let value = utils.getVariable(...args);
            if (!value) {
                this._postTask_unInitializedVariables.push(args[0]);
            }
            return value;
        }

        emitPostTask() {
            if (this._postTask_unInitializedVariables.length) {
                log.warn(`以下环境变量未预先初始化一个有效的值`, this._postTask_unInitializedVariables);
            }
        }
    };

    const services = new class _Services {
        constructor() {
            this._determinedHosts = new Set();
            this._allProfiles = config.get(Object, "remote.services", null, {});
            this._defaultProfile = "default";
            this._currentProfile = this._defaultProfile;
            this._use(this._defaultProfile);
        }

        _initCfg(cfg) {
            return Object.assign({
                token: "thisIsToken",
                host: "http://127.0.0.1:10999",
                cookiePrefix: "X-POSTMAN-DATA-",
                featurePath: "/_",
                pingPath: "/ping",
                pingResponse: "pong",
                echoPath: "/echo",
            }, cfg);
        }

        _prepareSender(profileCfg) {
            return new class _ServiceSender {
                constructor(profile, _parent) {
                    this.profile = profile;
                    this._parent = _parent;
                    this._data = null;
                    this._feature = null;
                }

                prepare(featureName, featureData, featureConf) {
                    const token = this.profile.token;
                    featureConf = _AESEncrypter.encrypt(token, JSON.stringify(featureConf));
                    this._data = _AESEncrypter.encrypt(token, `${featureName}|${featureConf}|${featureData}`);
                    this._feature = featureName;
                    return this;
                }

                // TODO: 使用一个类来统一处理响应格式问题
                send(forceDirect, requestExtras=null) {
                    if (!this._data || !this._feature) {
                        throw new SystemError;
                    }
                    const target = utils.joinUrlPath(this.profile.server, this.profile.featurePath);
                    const requester = Object.assign(requestExtras || {}, {
                        method: "POST",
                        header: Object.assign((requestExtras || {}).header || {}, {
                            "Postman-Feature-Name": this._feature,
                            "Postman-Feature-Direct": forceDirect ? "1" : "0"
                        }),
                        url: `${target}?feature=${this._feature}`,
                        body: new sdk.RequestBody({
                            mode: "raw",
                            raw: this._data
                        })
                    });
                    if (forceDirect) {
                        pm.request.update(requester);
                        return Promise.resolve(true);
                    }
                    return utils.sendRequest(requester);
                }

                replace(requestInfo) {
                    pm.request.update(requestInfo);
                    return Promise.resolve(true);
                }
            }(profileCfg, this);
        }

        async _selectProfile(profiles) {
            const tasks = profiles.map(function(profile) {
                const cfg = this._use(profile);
                // tips: 使用并行
                return (async() => await new Promise((resolve, reject) => {
                    if (this._determinedHosts.has(cfg.server)) {
                        return resolve(profile);
                    }
                    // TODO: 使用一个类来统一处理响应格式问题
                    const pingApi = utils.joinUrlPath(cfg.server, cfg.pingPath);
                    utils.sendRequest({
                        url: pingApi,
                        dataType: "text",
                        gracefulDown: true,
                        raiseForStatus: true,
                        okFinal: function(responseText) {
                            return responseText === cfg.pingResponse;
                        }
                    }).then(() => {
                        return resolve(profile);
                    }).catch((error) => {
                        log.warn(`此服务不可用："${cfg.server}"`, error);
                        return reject(new SystemError(error));
                    });
                }))();
            }, this);
            // tips: Promise.race([])，必须确保参数长度不为0，否则此Promise将一直pending
            if (tasks.length === 0) {
                throw new SystemError(`请先配置默认服务`);
            }
            // tips: postman中暂不支持 Promise.any() 方法
            return Promise.race(tasks).then(function(profile) {
                const cfg = this._use(profile);
                log.debug(`已选择可用服务：${cfg.server}`, {
                    profileName: profile,
                    profileData: cfg,
                    useCache: this._determinedHosts.has(cfg.server)
                });
                this._determinedHosts.add(cfg.server);
                return profile;
            }.bind(this));
        }

        _use(profile) {
            if (!this._allProfiles.hasOwnProperty(profile)) {
                if (profile === this._defaultProfile) {
                    return this._initCfg({});
                }
                throw new SystemError(`无效的服务配置别名：【${profile}】。可配置值：[${[...Object.keys(this._allProfiles)].join(", ")}]`);
            }
            profile !== this._currentProfile && (this._currentProfile = profile);
            return this._initCfg(this._allProfiles[profile]);
        }

        async determineService(alternativeProfiles=[], forcePingOnSingle=false) {
            alternativeProfiles = !alternativeProfiles
                ? []
                : Array.isArray(alternativeProfiles)
                    ? alternativeProfiles
                    : [alternativeProfiles];
            const count = alternativeProfiles.length;
            count === 0 && (alternativeProfiles = [this._defaultProfile]);
            return this._prepareSender(count === 1 && !forcePingOnSingle
                ? this._use(alternativeProfiles[0])
                : this._use(await this._selectProfile(alternativeProfiles)));
        }
    };

    const _defaultExecutor = class {
        static STATE_INIT = "INIT";
        static STATE_PREPARED = "PREPARED";
        static STATE_RUNNING = "RUNNING";
        static STATE_FINISHED = "FINISHED";

        /**
         * @lang: <String>
         * @cfg: {
         *     profile: <Array[<String>]>|<String>
         *     directReturn: <Boolean>
         *     validator: <Function>
         *     requestExtras: <Object>
         * }
         * @feature: <String>, eg: "var", "convert" ....
         */
        constructor(lang, cfg, feature) {
            this.cfg = Object.assign({
                profile: null,
                directReturn: true,
                validator: null,
                requestExtras: null
            }, cfg || {});

            this.lang = lang;
            this.feature = feature;

            this._script = null;
            this._scriptRunner = null;
            this._state = this.constructor.STATE_INIT;

            this._resultClass = class _resultClass {
                constructor(cfg, code, stdout, stderr) {
                    this.cfg = cfg;
                    this.code = code;
                    this.stdout = stdout;
                    this.stderr = stderr;
                }

                raiseForException() {
                    switch(true) {
                        case this.stderr instanceof Error:
                            throw new SystemError(this.stderr);
                        case this.stderr instanceof SendResult:
                            throw new SystemError(this.stderr.reason);
                        case _.isString(this.stderr) || _.isNumber(this.stderr):
                            throw new SystemError(this.stderr.toString());
                        case _.isObject(this.stderr):
                            throw new SystemError(this.stderr);
                        default:
                            return;
                    }
                }

                formatExecutorOutput() {
                    if (this.stdout && this.stdout instanceof SendResult) {
                        if (this.stdout.data && typeof this.stdout.data.data === "string") {
                            const cofiggedLength = config.get(Number, "local.remoteContent.maxLength", 4096);
                            if (this.stdout.data.data.length <= cofiggedLength) {
                                this.stdout.output = this.stdout.data.data;
                            }
                        }
                    }
                    return this;
                }
            }
        }

        _prepare(script, scriptRunner) {
            this._script = script;
            this._scriptRunner = scriptRunner;
            this._isSuccess = null;
            this._resultObj = null;
            this._state = this.constructor.STATE_PREPARED;
            return this;
        }

        _getInternalRunenr() {
            return this.lang === "js" ? this._scriptRunner() : this._scriptRunner;
        }

        _standardConverter(resultObj) {
            if (this.lang === "js") {
                if (resultObj.stderr === null) {
                    let converted = this._jsTypeConverter(resultObj.stdout);
                    resultObj.stdout = new SendResult({}, null, null, {
                        errno: 0,
                        msg: "ok",
                        desc: "",
                        data: converted,
                        warnings: [],
                        dataType: utils.getType(converted),
                        jsOriDataType: utils.getType(resultObj.stdout)
                    });
                } else {
                    resultObj.stderr = new SendResult({}, null, SendResult.REJECT_TYPE_DATA,
                        new SystemError(resultObj.stderr));
                }
            }
            return Object.freeze(resultObj);
        }

        _standardResponse(data) {
            switch (false) {
                case (Number.isSafeInteger(data.errno) && data.errno >= 0): break;
                case _.isString(data.msg): break;
                case _.isString(data.desc): break;
                case _.isArray(data.warnings): break;
                case ["isPlainObject", "isArray", "isString", "isNumber", "isNull"].some(attr => _[attr](data.data)): break;
                default:
                    return;
                    // const case1 = data.data !== null && _.isString(data.dataType) && !_.isEmpty(data.dataType);
                    // const case2 = data.data === null && !data.hasOwnProperty("dataType");
                    // if (case1 || case2) {
                    //     return;
                    // }
            }
            throw new SystemError("请求响应格式不符合规范", data).withWarnings(`响应格式要求如下： 
{
    "errno": 0,                     ..... <Integer>, >0
    "msg": "ok",                    ..... <String>
    "desc": "message",              ..... <String>
    "data": [],                     ..... <Object>|<Array>|<String>|<Number>|<Null>
    "dataType": "<class 'int'>",    ..... <String>, if data is valid, and not empty. or undefined
    "warnings": [ "warning1" ]      ..... <Array[<String>]>
    ....                            ..... other stuff
}`);
        }

        // TODO: 使用一个类来统一处理响应格式问题
        _standardTranslate(data) {
            if (data.errno !== 0) {
                throw new SystemError(`请求失败(errno=${data.errno})：${data.desc || data.msg}`, data)
                    .withRemoteStack(data.stack)
                    .withWarnings(data.warnings);
            } else {
                if (data.warnings.length > 0) {
                    for (let message of data.warnings) {
                        log.warn("warning(from remote): " + message);
                    }
                }
            }
        }

        /**
         * validate data(resp.data.data)
         */
        _standardValidate(detailedData) {
            try {
                this.cfg.validator && this.cfg.validator.call(this, detailedData);
            } catch(e) {
                throw new SystemError(e, this.cfg, { value: detailedData }).withLabel("请求结果校验失败");
            }
        }

        async _mainRunner() {
            return this._getInternalRunenr().call(this)

            .then(
                function(obj) {
                    return new this._resultClass(this.cfg, 0, obj, null);
                }.bind(this),
                function(obj) {
                    return new this._resultClass(this.cfg, 2, null, obj);
                }.bind(this))

            .then(function(resultObj) {
                this._resultObj = resultObj;
                return this._standardConverter(resultObj);
            }.bind(this))

            .then(function(resultObj) {
                resultObj.raiseForException();
                ["stderr", "stdout"].forEach(function(attr) {
                    if (resultObj[attr] && resultObj[attr].data) {
                        this._standardResponse(resultObj[attr].data);
                    }
                    if (attr === "stdout" && resultObj[attr]) {
                        this._standardTranslate(resultObj[attr].data);
                        this._standardValidate(resultObj[attr].data.data);
                    }
                }.bind(this));
                return resultObj.stdout;
            }.bind(this));
        }

        get state() {
            return this._state;
        }

        get isSuccess() {
            return this.state === this.constructor.STATE_FINISHED ? this._isSuccess : false;
        }

        get info() {
            return {
                lang: this.lang,
                feature: this.feature,
                script: Object.fromEntries([[this.lang, this._script]]),
                cfg: this.cfg
            };
        }

        run(script) {
            if (typeof script !== "string") {
                if (this.lang !== "generic") {
                    throw new SystemError(`若指定了特定语言，则@script参数必须为字符串类型`);
                } else
                if (!Array.isArray(script) || script.some(e => { return typeof e !== "string"; })) {
                    throw new SystemError(`若不指定特定语言，则@script参数必须为字符串类型或数组类型(每个元素须为字符串类型)`);
                }
            }
            return this._prepare(script, async function() {
                return services.determineService(this.cfg.profile, false)
                .then(function(sender) {
                    const featureConf = { lang: this.lang };
                    if (this.cfg.executorProfile) {
                        featureConf["executor"] = Object.assign({
                            lang: this.lang,
                            _subprocessShell: this.lang !== "generic"
                                ? false : Array.isArray(script)
                                ? false : true,
                            mainExtras: this.cfg.executorExtras || {}
                        }, this.cfg.executorProfile);
                    }
                    if (this.cfg.middlewareProfile) {
                        // 非执行中间件任务时不需发送 'middleware' 参数，从而
                        //   避免后台工程中非 /var 特性也需配置不相干的 'middleware' 参数
                        featureConf["middleware"] = Object.assign({
                            lang: this.lang,
                            mainExtras: this.cfg.middlewareExtras || {}
                        }, this.cfg.middlewareProfile);
                    }
                    return sender.prepare(this.feature, Array.isArray(script)
                        ? JSON.stringify(script) : script, featureConf
                    ).send(false, Object.assign({
                        dataType: "json",
                        raiseForStatus: true,
                        ok: function(resp) {
                            let headers = resp.headers.toObject();
                            if (headers["content-type"] !== "application/json; charset=utf-8") {
                                throw new SystemError(`请求响应不符合规范（必须指定Content-Type为"application/json; charset=utf-8"）`);
                            }
                            return true;
                        }
                    }, this.cfg.requestExtras || {}));
                }.bind(this));
            });
        }

        async getResult(cfgExtras={}) {
            if (!_.isPlainObject(cfgExtras)) {
                throw new SystemError;
            }
            if (this.state !== this.constructor.STATE_PREPARED) {
                throw new SystemError;
            }
            this._state = this.constructor.STATE_RUNNING;

            this.cfg.executorExtras = cfgExtras.executor || {};
            this.cfg.middlewareExtras = cfgExtras.middleware || {};

            log.debug("开始执行程序任务", this.info);
            return this._mainRunner.call(this)

            .finally(function() {
                this._state = this.constructor.STATE_FINISHED;
            }.bind(this))

            .catch(function(reason) {
                this._isSuccess = false;
                throw new SystemError(reason, {
                    result: this._resultObj,
                    executor: this.info
                }).withLabel(`程序任务执行失败`);
            }.bind(this))

            .then(function(stdout) {
                this._isSuccess = true;
                log.debug(`程序任务执行结果: `, {
                    result: this._resultObj.formatExecutorOutput(),
                    executor: this.info
                });
                if (this.cfg.directReturn) {
                    return Promise.resolve(Object.freeze(stdout.data.data));
                }
                return Promise.resolve(Object.freeze(stdout.data));
            }.bind(this));
        }
    };

    const _ExecutorProxyHandler = {
        construct: function(target, [language, cfg, feature], newTarget) {
            let supportLangs = [];
            if (typeof handlers === undefined) {
                throw new SystemError;
            }
            if (handlers.handlersMap.has(feature)) {
                // tips: special for /signer、/_sysvar feature
                supportLangs = handlers.handlersMap.get(["signer", "_sysvar"].includes(feature) ? "var" : feature)
                    .getInfosByPattern("PROP_SCRIPT_*", "PROP_MIDDLEWARE_*")
                    .map(obj => obj.propAlias)
                    .filter(name => name);
            }
            if (!this.hasOwnProperty(language)) {
                if (!supportLangs.includes(language)) {
                    throw new SystemError(`【/${feature}】：暂不支持【${language}】。当前支持的脚本语言/查询任务名称：${supportLangs}`);
                }
                this[language] = class extends _defaultExecutor {};
            }
            return new this[language](language, cfg, feature);
        },

        js: class _JsExecutor extends _defaultExecutor {
            _jsTypeConverter(obj) {
                const type = utils.getType(obj);
                switch (type) {
                    case '[object Number]':
                    case '[object String]':
                    case '[object Boolean]':
                        return obj.valueOf();
                    default:
                        return obj;
                }
            }

            run(script) {
                if (typeof script !== "string") {
                    throw new SystemError(`若指定了特定语言，则@script参数必须为字符串类型`);
                }
                return this._prepare(script, function() {
                    return new AsyncFunction(`"use strict"; return ${script};`);    // tips: 会立即检查函数体中可能的语法错误，从而抛出异常
                });
            }
        }
    };

    const Executor = new Proxy(_defaultExecutor, _ExecutorProxyHandler);

    const OptionItem = class _OptionItem {
        constructor(obj) {
            Object.assign(this, obj);
        }
    };

    const Options = class _Options {
        static commonOptionRegex = /^(?<optionShield>\\*)(?<optionFullName>(?<optionFlag>[a-zA-Z]*)\/(?<optionName>[a-zA-Z_0-9]+)(@(?<optionAlias>[a-zA-Z_0-9]*))?(\/(?<optionArg>\{\{[^{}]*?\}\}))?)(?<optionShield2>=*)$/;
        static commonSetPropertyRegex = /^(?<optionShield>\\*)(?<optionFullName>(?<optionFlag>[a-zA-Z]*)~(?<optionAlias>[a-zA-Z_0-9]+)\.(?<optionProperty>[a-zA-Z_0-9]+(\.[a-zA-Z_0-9]+)*))$/;
        static paramOptionRegex = _Options.bodyOptionRegex = _Options.commonOptionRegex;
        static paramSetPropertyRegex = _Options.bodySetPropertyRegex = _Options.commonSetPropertyRegex;
        static headerOptionRegex = new RegExp(_Options.commonOptionRegex.source.replace(/\\\\|\/|@/g, function (match) {
            return match === String.raw`\\` ? "`" : match === "/" ? "|" : match === "@" ? "#" : match;
        }));
        static headerSetPropertyRegex = new RegExp(_Options.commonSetPropertyRegex.source.replace(/\\\\|\//g, function (match) {
            return match === String.raw`\\` ? "`" : match === "/" ? "|" : match;
        }));

        constructor() {
            this.allOptions = {};
            this.allTokens = {};
            this.C = this.constructor;

            this._paramOptionItems = [];
            this._headerOptionItems = [];
            this._bodyOptionItems = [];
            this._allOptionItems = [];
        }

        /**
         * @item: <sdk.Property>
         * @source: <String>|<OptionItem>
         */
        _findAndAddTokens(item, source) {
            if (item.type && item.type === "file") {
                return;
            }
            // tips: 特性属性中的tokens已经合并到其父级内，因此只需统计父级的tokens即可
            const isOption = source instanceof OptionItem && !source.isProperty;
            // tips: 排除在 /_sysvar 前执行的特性中的内容
            const isProtectedOption = isOption && ["log", "initvar"].includes(
                source.isProperty ? source.parent : source.name);
            const keyTokens = isProtectedOption ? [] : utils.getVariableTokens(item.key || "", false, true);
            const valueTokens = isProtectedOption ? [] : utils.getVariableTokens(item.value || "", false, true);
            return [keyTokens, valueTokens].reduce(function(aSets, aTokens, i) {
                aTokens.forEach(([token]) => {
                    isOption && !isProtectedOption && aSets[i].add(token);
                    this.allTokens[token] = this.allTokens[token] || [];
                    this.allTokens[token].push({
                        source: source.source || source,
                        key: item.key
                    });
                });
                return aSets;
            }.bind(this), isOption
                ? [source.keyTokens, source.valueTokens]
                : [new Set(), new Set()]);
        }

        _parseOneForOption(item, pattern, source, oItems) {
            let isSpecial = false;
            if (/**source === "Params" && */!item.disabled && !(item.key && item.key.trim())) {
                item.key = "/convert";  item.disabled = true; isSpecial = true;
                let parts = (item.value || "").split("/");
                if (parts.length >= 2) {
                    item.key = parts[0] + item.key; item.value = parts.slice(1).join("");
                }
            }
            const result = item.key && item.key.trim().match(pattern);
            if (!result) {
                return;
            }
            const groups = result.groups,
                optionShield = Boolean(groups.optionShield) || Boolean(groups.optionShield2),
                optionFlag = groups.optionFlag,
                optionName = groups.optionName,
                optionFullName = groups.optionFullName,
                optionAlias = groups.optionAlias,
                optionArg = groups.optionArg;
            oItems.push(new OptionItem({
                id: utils.randomId(4),
                isProperty: false,
                source: source,
                name: optionName,
                fullName: optionFullName,
                alias: optionAlias,
                arg: optionArg,
                flag: optionFlag,
                properties: {},
                shielded: optionShield,
                disabled: Boolean(item.disabled),
                type: item.type,
                keyTokens: new Set(),
                valueTokens: new Set(),
                special: isSpecial,
                field: item
                // tips: getter 实际上已经失效，因为 Object.assign(this, obj) 已经读取过了
                // get field() {
                //     return item;
                // }
            }));
            return true;
        }

        _parseOneForOptionProperties(item, pattern, source, oItems) {
            const result = item.key && item.key.trim().match(pattern);
            if (!result) {
                // tips: 正常请求参数中的变量
                if (!item.disabled) {
                    this._findAndAddTokens(item, source);
                }
                return;
            }
            const groups = result.groups,
                propertyShield = Boolean(groups.optionShield),
                propertyFlag = groups.optionFlag,
                propertyName = groups.optionProperty,
                propertyFullName = groups.optionFullName,
                propertyParent = groups.optionAlias;
            oItems.push(new OptionItem({
                id: utils.randomId(4),
                isProperty: true,
                source: source,
                name: propertyName,
                fullName: propertyFullName,
                alias: "",
                parent: propertyParent,
                arg: null,
                flag: propertyFlag,
                shielded: propertyShield,
                disabled: Boolean(item.disabled),
                type: item.type,
                field: item,
                // tips: getter 实际上已经失效，因为 Object.assign(this, obj) 已经读取过了
                // get field() {
                //     return item;
                // }
            }));
            return true;        // return true if success
        }

        _parseCommonOptions(source, items, pattern1, pattern2, oItems, oTokens) {
            items && items.each(item => {
                if (!item.disabled && (!item.key || /\s/.test(item.key))) {
                    log.warn(`在解析${source}特性【${item.key}】时：发现字段名称为空或包含空格`, item);
                }
                return this._parseOneForOption(item, pattern1, source, oItems)
                    || this._parseOneForOptionProperties(item, pattern2, source, oItems);
            });
        }

        _parseParamsOptions(params) {
            this._parseCommonOptions("Params", params, this.C.paramOptionRegex,
                this.C.paramSetPropertyRegex, this._paramOptionItems, this.allTokens);
            log.verbose(`Params特性解析结果`, this._paramOptionItems);
        }

        _parseHeaderOptions(headers) {
            this._parseCommonOptions("Headers", headers, this.C.headerOptionRegex,
                this.C.headerSetPropertyRegex, this._headerOptionItems, this.allTokens);
            log.verbose(`Headers特性解析结果`, this._headerOptionItems);
        }

        _parseBodyOptions(body) {
            if (!parameters.isFormBodyStyle) {
                this._findAndAddTokens({
                    key: null,
                    value: parameters.data,
                }, "Body");
            } else {
                this._parseCommonOptions("Body", body, this.C.bodyOptionRegex,
                this.C.bodySetPropertyRegex, this._bodyOptionItems, this.allTokens);
            }
            log.verbose(`Body特性解析结果`, this._bodyOptionItems);
        }

        _findPropertiesForOption(item, alias, propItems, knownCommon, isCommonOption) {
            // tips: 使用 reduceRight() 可以在 splice() 后继续遍历后续的元素
            return propItems.reduceRight((properties, propItem, idx, src) => {
                if (propItem.parent === alias) {
                    const parts = propItem.name.split("."), lastIndex = parts.length - 1;
                    parts.reduce((node, key, i) => {
                        node[key] = node[key] || (i === lastIndex ? propItem : {});
                        node = node[key];
                        if (i !== lastIndex && node instanceof OptionItem) {
                            throw new SystemError(`特性属性定义存在冲突：与${node.source}特性属性【${node.name}】冲突`).withLabel(`在解析${propItem.source}特性属性【${propItem.name}】时`);
                        }
                        return node;
                    }, properties);
                    isCommonOption ? knownCommon[alias] || (knownCommon[alias] = src[idx]) : src.splice(idx, 1);
                }
                // const keyTokens = new Set(utils.getVariableTokens(propItem.field.key, false, false));
                // const valueTokens = new Set(utils.getVariableTokens(propItem.field.value, false, false));
                this._findAndAddTokens(propItem.field, propItem);
                // if (propItem.keyTokens.size > 0) {
                //     throw new SystemError(`特性属性定义错误：键名禁止包含变量引用`).withLabel(`在解析${propItem.source}特性属性【${propItem.name}】时`);
                // }
                // item.keyTokens = utils.setUnion(item.keyTokens, keyTokens);
                // item.valuesTokens = utils.setUnion(item.valueTokens, valueTokens);
                return properties;
            }, {});
        }

        _toMerge() {
            let all = [this._paramOptionItems, this._headerOptionItems, this._bodyOptionItems].flat();
            let propertyAllUnMerged = all.filter(item => item.isProperty && !item.shielded), commonPropertyMerged = {};
            let result = [], defined = {}, alias_defined = [];
            all.forEach(function (item) {
                item.arg && (item.arg = item.arg.replace(/^\{\{|\}\}$/g, ""));
                if (item.arg === "" || item.arg && item.arg.includes(" ")) {
                    log.warn(`发现${item.source}特性【${item.fullName}】变量参数为空变量或变量名称包含空格`);
                }
                let uniqueKey = item.isProperty
                    ? item.parent + "." + item.name
                    : (item.arg == null ? item.name : `${item.name}+${item.arg}`);
                if (!item.disabled) {
                    throw new SystemError(`作为特性的字段不能处于勾选状态`).withLabel(`在解析${item.source}特性【${item.fullName}】时`);
                }
                if (item.shielded) {
                    return;
                }

                if (defined.hasOwnProperty(uniqueKey)) {
                    throw new SystemError(`特性重复定义：与${defined[uniqueKey][1]}特性【${defined[uniqueKey][0]}】发生重复。唯一键：${uniqueKey}`).withLabel(`在解析${item.source}特性【${item.fullName}】时`);
                }
                if (item.alias && alias_defined.hasOwnProperty(item.alias)) {
                    throw new SystemError(`特性定义存在冲突：与${alias_defined[item.alias][1]}特性【${alias_defined[item.alias][0]}】冲突。冲突键：${item.alias}`).withLabel(`在解析${item.source}特性【${item.fullName}】时`);
                }
                defined[uniqueKey] = [item.fullName, item.source];
                item.alias && (alias_defined[item.alias] = [item.fullName, item.source]);
                if (item.isProperty) {
                    return;
                }

                // item.keyTokens = new Set(utils.getVariableTokens(item.arg, false, false));
                // item.valueTokens = new Set(utils.getVariableTokens(item.field.value, false, false));
                this._findAndAddTokens(item.field, item);
                // if (item.keyTokens.size > 1) {
                //     throw new SystemError(`特性定义错误：键名最多只能包含一个变量引用`).withLabel(`在解析${item.source}特性【${item.fullName}】时`);
                // }
                item.name && Object.assign(item.properties,
                    this._findPropertiesForOption(item, item.name, propertyAllUnMerged, commonPropertyMerged, true));
                item.alias && Object.assign(item.properties,
                    this._findPropertiesForOption(item, item.alias, propertyAllUnMerged, commonPropertyMerged, false));
                result.push(item);
            }, this);
            if (propertyAllUnMerged.length) {
                let msg = propertyAllUnMerged.reduceRight((acc, item, idx, src) => {
                    if (commonPropertyMerged.hasOwnProperty(item.parent)) {
                        src.splice(idx, 1);
                        return acc;
                    }
                    return `${acc}${" ".repeat(4)}${item.source}特性属性【${item.fullName}】\n`;
                }, "\n");
                msg = propertyAllUnMerged.length > 1 ? msg.trimEnd() : msg.trim();
                msg && log.warn(`以下特性属性定义未被引用: ${msg}`);
            }
            this._allOptionItems = result;
            log.verbose("Params/Headers/Body特性合并结果", this._allOptionItems);
        }

        _toObject() {
            this._allOptionItems.forEach(function (item) {
                if (item.shielded) {
                    return;
                }
                this.allOptions[item.name] = this.allOptions[item.name] || [];
                this.allOptions[item.name].push(item);
            }, this);
            utils.setVariable("__postman.script.parsedOptions__", [...Object.keys(this.allOptions)].join(","));
            log.debug("特性解析结果", this.allOptions);
        }

        _toPreProcess() {
            if (this.allOptions.log) {
                let optionItem = this.allOptions.log[0];
                try {log.setLevel(optionItem.field.value);}
                catch (e) {}
            }
            log.emit();
            handlers.init(this.allOptions, this.allTokens);
            log.verbose("特性处理器初始化完成");
        }

        async _toProcess() {
            log.debug("开始处理特性");
            return [...handlers.sort()].reduce(function(lastPromise, orderedGroup, idx, src) {
                return lastPromise.then(() => {
                    log.debug(`开始处理分组特性，分组${idx}/${src.length}，当前特性 /${orderedGroup[0].option.name}`, orderedGroup);
                    return Promise.all(orderedGroup.map(one => one.process()));
                })
            }, Promise.resolve(true))
            .finally(() => {
                log.verbose("特性处理完成");
            });
        }

        _dealEnvPostTask() {
            env.emitPostTask();
            log.verbose(`后置任务处理完成`);
        }

        async parseFromRequest() {
            if (isEvalMode) {
                // 非 collection 级别下运行时不再重复解析
                return Promise.resolve();
            }
            const query = parameters.params,
                headers = parameters.headers,
                body = parameters.data;
            log.debug(`开始分析特性`);
            this._parseParamsOptions(query);
            this._parseHeaderOptions(headers);
            this._parseBodyOptions(body);
            this._toMerge();
            this._toObject();
            try {
                this._toPreProcess();
                return this._toProcess()
                .finally(function() {
                    this._dealEnvPostTask();
                }.bind(this));
            } catch(e) {
                this._dealEnvPostTask();
                throw new SystemError(e);
            }
        }
    };

    const _ResolveTypes = class {
        static RESOLVE_ANY_TYPE(item) {
            return item.value;
        }

        static RESOLVE_ANY_EXCEPT_EMPTY_TYPE(item) {
            if (![null, undefined, NaN, ""].includes(item.value)) {
                return item.value;
            }
            throw new SystemError(`字段值已设定为不能为空（指字符串长度为零）`);
        }

        static RESOLVE_BOOLEAN_TYPE(item) {
            let isString = typeof item.value === "string";
            if (["1", 1].includes(item.value) || isString && item.value.toLowerCase() === "true") {
                return true;
            } else
                if (["0", 0].includes(item.value) || isString && item.value.toLowerCase() === "false") {
                    return false;
                }
            throw new SystemError(`字段值不是可转换为Boolean类型的值`);
        };

        static RESOLVE_BOOLEAN_FALSE_TYPE(item) {
            let isString = typeof item.value === "string";
            if (["0", 0].includes(item.value) || isString && item.value.toLowerCase() === "false") {
                return false;
            }
            throw new SystemError(`字段值不是可转换为Boolean-false类型的值`);
        }

        static RESOLVE_LOGLEVEL_TYPE(item) {
            let name = item.value && item.value.trim().toLowerCase();
            if (log.C.hasLevel(name)) {
                return name;
            }
            throw new SystemError(`未定义的日志级别名称：${item.value}。当前支持的日志级别：${log.C.levels}`);
        }

        static RESOLVE_CONVERT_FORMAT_TYPE(item) {
            if (typeof handlers == undefined) {
                throw new SystemError;
            }
            let name = item.value && item.value.trim().toLowerCase(),
                convertHandler = handlers.handlersMap.get("convert"),
                formatMap = convertHandler.constructor._recycle_rules;
            if (formatMap && formatMap.has(name)) {
                return name;
            }
            if (!name || name === "auto") {
                return null;
            }
            throw new SystemError(`未定义的转换格式名称：【${item.value}】，当前支持的转换格式：${[...formatMap.keys()]},auto,空(=auto)`);
        }

        static RESOLVE_SIGNER_NAME_TYPE(item) {
            const name = item.value && item.value.trim();
            const list = $$.signer.list;
            if (list.includes(name)) {
                return name;
            }
            throw new SystemError(`未定义的请求签名方法：【${item.value}】，当前支持的签名方法：[${list.join(", ")}]`);
        }

        static RESOLVE_EXTRA_TYPE(item) {
            const values = utils.getList(item.value, true, ["+", "-"])
            .reduce((acc, cur, idx, arr) => {
                if (!["+", "-"].includes(cur[0]) || cur.length === 1) {
                    throw new SystemError(`无效的功能开关参数：【${cur}】，在【${arr.slice(0, idx + 1).join("")}】附近`);
                }
                // @return: Array[Array[flag, name]]
                acc.push([cur[0], cur.substring(1).trim()]);
                return acc;
            }, []);
            return values;
        }
    };

    const HandlerBase = class _Handlerbase {
        static STATUS_OFF = "off";
        static STATUS_OMITTED = "omitted";
        static STATUS_UNDETERMINED = "undetermined";

        static ANY_ARG_REQUIRED = {"+": "+"};
        static ANY_ARG_OPTIONAL = {"*": "*"};

        static assumeHandler = class {
            constructor(option) {
                // defineReadOnly(this, "option", option, true);
                this.option = option;
            }

            get value() {
                if (this._value === undefined || this._value === null) {
                    return this.option.field.value || "";
                }
                return this._value;
            }
        };

        /**
         * @override: <Object>
         */
        static FLAGS = {};

        /**
         * @override: <Object>
         */
        static ARGS = {};

        /**
         * @override: <Object>
         */
        static PROPERTIES = {};

        /**
         * @override: 返回一个函数：函数须返回二维数组：<Array[<Array>[#BoxedObj]>]>, this指向实例
         */
        static ON_ORDERS = null;

        /**
         * @override: 返回一个函数：将忽略函数返回值, this指向实例
         */
        static ON_DEFAULT = null;

        /**
         * @override: <Boolean#isSingleton>, default: <true>
         */
        static _singleton = true;

        /**
         * @override: <Boolean>
         */
        static _pre_get_inline = false;

        /**
         * @override: <Array[<Function>#Resolver, <Boolean>#asOffSwitch, <Boolean>#asSwitch]>
         */
        static _resolve_cfg = {
            resolver: _ResolveTypes.RESOLVE_ANY_TYPE,
            asOffSwitch: false,
            asSwitch: false,
        };

        static _varSubFeatureNames = [
            // 编程语言
            ["js", "nodejs", "python", "shell", "wincmd", "powershell"],
            // 中间件-数据库
            ["mysql", "mongodb", "redis", "elastic"]
        ];

        constructor() {
            this.P = this;
            this.C = this.constructor;
            this.ARGS = this.C.ARGS;
            this.FLAGS = this.C.FLAGS;
            this.PROPERTIES = this.C.PROPERTIES;
            this.ON_DEFAULT = this.C.ON_DEFAULT;
            this.ON_ORDERS = this.C.ON_ORDERS;
            // defineReadOnly(this, ["!"], false);

            this._singleton = this.C._singleton;
            this._resolve_cfg = this.C._resolve_cfg;
            this._cache = new Map();    // tips: for infoGetter
            // defineReadOnly(this, ["!", "_cache"], false);
            // tips: 原型链中的_cache属性没法设为只读，因为对实例自身的_cache 属性的每一次赋值都会检查原型链中该属性的可写状态
            // defineVisible(this, ["_cache"], false);
            // defineVisible(this, ["!"], false);
            this._registerNoOptionDependProxy();
        }

        // tips: 兼容打印<Proxy>
        // toJSON() {
        //     const thisCopy = Object.assign({}, this);
        //     delete thisCopy.info;
        //     delete thisCopy.has;
        //     delete thisCopy.is;
        //     delete thisCopy.get;
        //     return thisCopy;
        // }

        _ensureInvoker() {
            if (!this.option) {
                throw new SystemError;
            }
            if (!this._isRegistered) {
                this._cache = new Map();    // tips: for isGetter, hasGetter, getGetter
                this._isRegistered = false;
                this._registerOptionDependProxy();
                this._isRegistered = true;
                this._isResolved = false;
                this._value = null;
                this._label = "";
                this._cfg = {};
                // defineReadOnly(this, ["_cache", "_isRegistered"], false);
                // defineVisible(this, ["_isResolved", "_value"], false);
                // defineVisible(this, ["_cache", "_isRegistered", "_isResolved", "_value", "_label", "_cfg"], false);
            }
        }

        _registerNoOptionDependProxy() {
            for (let attr of ["info"]) {
                // tips: 参见 NOTE:2
                defineReadOnly(this, attr, new Proxy(this, { get: this[`_${attr}Getter`] }), false);
            }
        }

        _registerOptionDependProxy() {
            for (let attr of ["is", "has", "hasDef", "get"]) {
                // tips: 参见 NOTE:2
                defineReadOnly(this, attr, new Proxy(this, { get: this[`_${attr}Getter`] }), false);
            }
        }

        _infoGetter(target, attr) {
            let key = `CACHED_INFO_${attr}`, {_cache, PROPERTIES} = target;
            if (!(attr.startsWith("PROP_") && PROPERTIES.hasOwnProperty(attr))) {
                if (attr === "toJSON") return {};
                throw new SystemError;
            }
            return _cache.has(key)
                ? _cache.get(key)
                : _cache.set(key, {
                    propAttr: attr,
                    propName: PROPERTIES[attr][0],
                    propAlias: PROPERTIES[attr][2]
                }).get(key);
        }

        _isGetter(target, attr) {
            let key = `CACHED_IS_${attr}`, {_cache, option, ARGS} = target;
            if (!(attr.startsWith("ARG_") && ARGS.hasOwnProperty(attr))) {
                if (attr === "toJSON") return {};
                throw new SystemError;
            }
            return _cache.has(key)
                ? _cache.get(key)
                : _cache.set(key, option.arg === ARGS[attr][0]).get(key);
        }

        _hasDefGetter(target, attr) {
            if (attr === "toJSON") return {};
            return target.PROPERTIES.hasOwnProperty(attr);
        }

        _hasGetter(target, attr) {
            let key = `CACHED_HAS_${attr}`, {_cache, option, FLAGS, PROPERTIES} = target;
            if (!(attr.startsWith("FLAG_") && FLAGS.hasOwnProperty(attr))
                && !(attr.startsWith("PROP_") && PROPERTIES.hasOwnProperty(attr))) {
                if (attr === "toJSON") return {};
                throw new SystemError;
            }
            if (attr.startsWith("FLAG_")) {
                return _cache.has(key)
                    ? _cache.get(key)
                    : _cache.set(key, (option.flag || "").includes(FLAGS[attr][0])).get(key);
            } else if (attr.startsWith("PROP_")) {
                // tips: 不包括行内定义的属性
                // TODO: hasGetter, getGetter 统一块定义与行内定义属性的处理方式，要考虑是否与resolve()的兼容
                const _oriNames = option.properties._oriNames;
                return _cache.has(key)
                    ? _cache.get(key)
                    : _oriNames
                        ? _cache.set(key, _oriNames.has(PROPERTIES[attr][0])).get(key)
                        : _cache.set(key, false).get(key);
            }
        }

        _getGetter(target, attr) {
            // _complex: function(target, propName) {
            //     let stopIter = false;
            //     return propName.split(".").reduce((obj, key, idx) => {
            //         if (key === "[]" || stopIter) {
            //             stopIter = true;
            //             return obj;
            //         }
            //         return obj[key];
            //     }, target.option.properties);
            // }
            function _toGet(target, option, propsDef, attr) {
                // if (propConf[0].includes("[]")) {
                //     return this._complex(target, propConf[0]);
                // }
                let propConf = propsDef[attr];
                let parts = propConf[0].split("."), lastIndex = parts.length - 1;
                return parts.reduce((obj, key, idx) => {
                    if (obj && idx === lastIndex) {
                        // console.log(obj[key], propConf);
                        // return new HandlerBase.assumeHandler(obj[key], propConf[2]);
                        return new target.C.assumeHandler(obj[key]);
                    }
                    return obj[key];
                }, option.properties);
            }

            let key = `CACHED_GET_${attr}`, {_cache, option, PROPERTIES} = target;
            if (!attr.startsWith("PROP_")) {
                if (attr === "toJSON") return {};
                throw new SystemError;
            }
            // tips: 不包括行内定义的属性
            // TODO: hasGetter, getGetter 统一块定义与行内定义属性的处理方式，要考虑是否与resolve()的兼容
            return _cache.has(key)
                ? _cache.get(key)
                : _cache.set(key, _toGet(target, option, PROPERTIES, attr)).get(key);
        }

        _checkFlag() {
            this._ensureInvoker();
            let flags = new Set(this.option.flag), aflags = Array.from(flags);      // new Set(null).size == 0
            let duplicated = aflags.filter(function (flag) {
                return this.option.flag.match(new RegExp(flag, "g")).length > 1;
            }, this);
            if (duplicated.length) {
                log.warn(`在解析${this.option.source}特性【${this.option.fullName}】时：标记重复：${duplicated.join()}`);
            }

            let defs = new Set(Object.values(this.FLAGS).map(([name, desc]) => name));
            let undefineds = aflags.filter(function (flag) {
                return !defs.has(flag);
            }, this);
            if (undefineds.length) {
                throw new SystemError(`未定义的特性标记：${undefineds.join()}`);
            }
            return this;
        }

        _addExtraPropsInfo(propOwn) {
            this._ensureInvoker();
            this.option.properties._oriNames || Object.setPrototypeOf(this.option.properties, {
                _oriNames: new Set()
            });
            this.option.properties._oriNames.add(propOwn);
        }

        _checkProperty() {
            this._ensureInvoker();
            const unKnownProps = [];
            const _recursiveCheck = function (obj, prefix, propDefNames) {
                prefix = prefix === null ? "" : prefix;
                Object.entries(obj).forEach(function ([k, v]) {
                    if (v instanceof OptionItem) {
                        let name = prefix + k;
                        if (!propDefNames.includes(name)) {
                            return unKnownProps.push(name);
                        }
                        return this._addExtraPropsInfo(name);
                    } else {
                        return _recursiveCheck(v, prefix + (/^[0-9]+$/.test(k) ? "[]" : k) + ".", propDefNames);
                    }
                }, this);
            }.bind(this);

            const propNames = Object.values(this.PROPERTIES).map(([name]) => name);
            _recursiveCheck(this.option.properties, null, propNames);
            if (unKnownProps.length) {
                throw new SystemError(`未定义的特性属性：【${unKnownProps.join()}】`);
            }
            return this;
        }

        _checkArgs() {
            this._ensureInvoker();
            if (!_.isEmpty(this.ARGS)) {    // tips: _.isEmpty(1) === true
                const argOptional = this.ARGS === this.C.ANY_ARG_OPTIONAL;
                if (this.option.arg == null && !argOptional) {
                    throw new SystemError("未指定有效的特性参数");
                }
                if (this.C._singleton && this.siblings.members.length > 1) {
                    throw new SystemError(`该特性不允许同时定义多个实例：${this.siblings.members.map(e => `【${e.option.fullName}】`)}`);
                }
            }
            return this;
        }

        async _doDefault() {
            this.ON_DEFAULT && await this.ON_DEFAULT.call(this);
        }

        async _postProcess() {
            this._ensureInvoker();
            this.isDisabled() && await this._doDefault();
            return this;
        }

        get value() {
            this._ensureInvoker();
            if (this._value == null) {
                return this.option.field.value || "";
            }
            return this._value;
        }

        set value(value) {
            this._ensureInvoker();
            this._value = value;
        }

        get cfg() {
            this._ensureInvoker();
            return this._cfg;
        }

        // tips: 避免书写过多的 try .... catch ....
        setExceptionLabel(label) {
            this._ensureInvoker();
            this._label = label;
        }

        setName(name) {
            defineReadOnly(this.P, "name", name, true);
        }

        setStatus(status) {
            if (status === this.C.STATUS_OFF) {
                defineReadOnly(this.P, "status", status);
            } else {
                this.P.status = status;
            }
        }

        setService(forcePingOnSingle, forceDirect, data=null) {
            if (data && typeof data !== "string") {
                throw new SystemError;
            }
            const alternativeProfiles = this.getServiceProfile();
            const promise = services.determineService(alternativeProfiles, forcePingOnSingle);
            return data === null
                ? promise
                : promise.then(sender => {
                    return sender.prepare(this.name, data, this.cfg || {})
                        .send(forceDirect)
                    });
        }

        configGet(...args) {
            return config.get(...args);
        }

        cacheGet() {
            let key = `__postman.handler.${this.name.toLowerCase()}.cache__`;
            return new class {
                constructor(featureName, cacheKey, textData) {
                    this.feature = featureName;
                    this.key = cacheKey;
                    try {
                        this.data = JSON.parse(textData);
                        if (!_.isPlainObject(this.data)) {
                            throw new SystemError;
                        }
                    } catch(e) {
                        if (textData != null) {
                            log.warn(`发现 /${this.feature} 特性缓存数据不是有效的JSON："${this.key}"`);
                        }
                        this.data = {};
                    }
                }

                get hasData() {
                    return !_.isEmpty(this.data);
                }

                new(data) {
                    if (!_.isPlainObject(data)) {
                        throw new SystemError;
                    }
                    utils.setVariable(this.key, JSON.stringify(data));
                }

                update(data, obj=null) {
                    obj = obj ? obj : this.data;
                    obj = Object.assign(obj, data);
                    this.save();
                }

                save() {
                    utils.setVariable(this.key, JSON.stringify(this.data));
                }

                delete() {
                    utils.unsetVariable(this.key);
                }

            }(this.name, key, utils.getVariable(key));
        }

        /**
         * @pattern: <Array[<String>]>
         * 仅支持前导*号或尾导*号，不支持*号出现在中间
         *  example:
         *    getInfosByPattern("PROP_SCRIPT_*")
         * 支持指定多个模式
         *    getInfosByPattern("PROP_SCRIPT_*", "PROP_MIDDLEWARE_*")
         */
        getInfosByPattern(...patterns) {
            const substrings = patterns.map(pattern => pattern.replace(/^\*|\*$/g, ""));
            return Object.keys(this.PROPERTIES)
            .filter(key => {
                return substrings.some(substring => key.indexOf(substring) !== -1);
            }).map(function(key) {
                return this.info[key];
            },  this);
        }

        isOmitted() {
            return this.status === this.C.STATUS_OMITTED;
        }

        isDisabled() {
            this._ensureInvoker();
            if (this.isOmitted() || this.status === this.C.STATUS_OFF) {
                return true;
            }
            this._isResolved || this.resolve(null);
            return this.status === this.C.STATUS_OFF;
        }

        // @asSwitch: deprecated
        resolve(callback, resolver=null, asOffSwitch=null, asSwitch=null) {
            this._ensureInvoker();
            const cfg = Reflect.get(this.C, "_resolve_cfg", this);
            if (!Array.isArray(cfg) || cfg.length < 3) {
                throw new SystemError;
            }
            const [$resolver, $asOffSwitch, $asSwitch] = cfg;
            resolver = resolver != null ? $resolver : $resolver;
            asOffSwitch = asOffSwitch != null ? asOffSwitch : $asOffSwitch;
            // asSwitch = asSwitch != null ? asSwitch : $asSwitch;
            this.C._pre_get_inline && !this.isOmitted() && this.getInline();
            const subValue = this.C._pre_get_inline ? { value: this.value } : this.option.field;
            if (asOffSwitch) {
                try {
                    _ResolveTypes.RESOLVE_BOOLEAN_FALSE_TYPE(subValue);
                    this.setStatus(this.C.STATUS_OFF);
                } catch (e) { asOffSwitch = false; }
            }
            if (asOffSwitch) {
                this._isResolved = true;
                return;
            }
            // if (resolver === _ResolveTypes.RESOLVE_BOOLEAN_TYPE) {
            //     let resolved = resolver(this.option.field);
            //     // asSwitch && !resolved && this.setStatus(this.C.STATUS_OFF); // tips: 会导致重复调用ON_DEFAULT()
            //     this._isResolved = true;
            //     return callback && callback.call(this, resolved);;
            // }
            this._isResolved = true;
            return callback && callback.call(this, resolver(subValue));
        }

        getInline() {
            this._ensureInvoker();
            if (this._inlineData) {
                return this._inlineData;
            }
            if (typeof this.value !== "string") {
                throw new SystemError;
            }
            let aliases = Object.entries(this.PROPERTIES).reduce(function(aliases,
                [propAttr, [name, , alias, boolStyle, allowEmpty]]) {
                if (alias) {
                    if (!/^[-a-z_0-9]+$/.test(alias) || aliases.hasOwnProperty(alias)) {
                        throw new SystemError;
                    }
                }
                alias && (aliases[alias] = [propAttr, name, boolStyle, allowEmpty]);
                return aliases;
            }.bind(this), {});
            let a = this.value.substr(0, 1), b = this.value.substr(1, 1),
                L = this.value.length > 2 && utils.isAsciiPunct(a),
                R = this.value.length > 2 && utils.isAsciiPunct(b),
                isCustomSep = L && R,
                splitPattern = /(?=【[-a-zA-Z_0-9]*】|~[-a-zA-Z_0-9]*~)/;   // default
            if (isCustomSep) {
                [a, b] = [a, b].map(e => e.replace(/([\+\*\^\$\.\?\(\)\[\]\{\}\\])/g, "\\$1"));
                splitPattern = new RegExp(String.raw`(?=${a}[-a-zA-Z_0-9]*${b})`);
            }

            let parts = (isCustomSep ? this.value.substr(2) : this.value).split(splitPattern);
            this._inlineData = parts.reduce(function(obj, part, idx, src) {
                let startWithPrefix = isCustomSep
                    ? new RegExp(String.raw`^${a}([a-zA-Z_0-9]*)${b}`).test(part.trim())
                    : /^【([-a-zA-Z_0-9]*)】|^~([-a-zA-Z_0-9]*)~/.test(part.trim());
                if (!startWithPrefix) {
                    if (src.length > 1 && idx < 1) {
                        throw new SystemError(`行内属性定义，在实际属性定义之前禁止出现无意义内容：${part}`);
                    }
                    return obj;
                }
                let propShortName = RegExp.$1,
                    propValue = RegExp.rightContext,
                    matched = RegExp.lastMatch;
                if (!propShortName) {   // tips: eg: 【】...
                    if (src.length === 1) {
                        throw new SystemError(`行内属性定义，若没有实质性的属性定义，则不应该单独出现属性结束标识`);
                    }
                    if (this._value != null) {
                        throw new SystemError(`行内属性定义，属性结束标识最多只能出现一次`);
                    }
                    if (this.name === "var" && !propValue.includes("{{}}")) {
                        // 使用简化方法定义脚本命令/中间件任务时，空变量 {{}} 含义有所不同：
                        //   非简化方式：空变量将使用执行结果替换
                        //   简化方式：空变量为普通变量，不会使用执行结果替换
                        // 另见 /var.setVar()
                        if (this.option && !this.option.isChild) {
                            throw new SystemError(`对于 /var 特性，要求替代值表达式中必须出现外部任务执行结果的占位标识("{{}}")：${propValue}`);
                        }
                    }
                    this.value = propValue.trim();
                    return obj;
                }

                let aliasName = propShortName.toLowerCase();
                if (!aliases.hasOwnProperty(aliasName)) {
                    throw new SystemError(`未定义的特性属性别名：【${matched}】`);
                }
                let [propAttr, propName, boolStyle, allowEmpty] = aliases[aliasName];
                if (!boolStyle && !allowEmpty && !propValue.trim()) {
                    throw new SystemError(`该特性属性值不能为空: 【${matched}】`);
                }
                if (this.has[propAttr]) {
                    throw new SystemError(`特性属性定义冲突：不能同时使用块定义【${propName}】与行内定义【${matched}】`);
                }
                if (obj.hasOwnProperty(aliasName)) {
                    throw new SystemError(`同一属性不允许重复定义：【${aliasName}】`);
                }
                obj[aliasName] = boolStyle ? true : propValue.trim();
                return obj;
            }.bind(this), {});
            log.debug(`获取${this.option.source}行内特性属性【${this.option.fullName}】`, {
                info: {
                    pattern: splitPattern,
                    splitResult: parts,
                    resultObj: this._inlineData
                }
            });
            return this._inlineData;
        }

        /**
         * @propInfo: <Object>
         * @asObject: <Boolean>
         * @handler: <Function> -> <Object>, typically, utils.getList.bind(utils)
         * @return: <String|null>, null if empty
         *          <Object[aliasName, fieldValue]>
         */
        getInOne({propAttr, propAlias}, asObject=false, handler=null) {
            this._ensureInvoker();
            let inline = this.getInline();
            let value = inline.hasOwnProperty(propAlias)
                ? inline[propAlias] : this.has[propAttr]
                ? this.get[propAttr].value : null;
            handler && (value = handler(value));
            return asObject
                ? Object.fromEntries([[propAlias, value]])
                : value;
        }

        /**
         * @propsInfo: <Array[propInfo]>
         * @filter: <Boolean>, use _.isEmpty()
         * @asObject: <Boolean>
         * @asObjectInner: <Boolean>
         * @handler: <Function> -> <Object>, typically, utils.getList.bind(utils)
         * @return: Array[fieldValue]
         *          Array[Object[aliasName, fieldValue]]
         *          Object[aliasName, fieldValue]
         */
        getManyInOne(propsInfo, filter=false, asObject=false, asObjectInner=false, handler=null) {
            this._ensureInvoker();
            if (asObject) {
                return propsInfo.reduce(function(obj, propInfo) {
                    let one = this.getInOne(propInfo, true, handler);
                    return !filter
                        ? Object.assign(obj, one) : !one[propInfo.propAlias]
                        ? obj : Object.assign(obj, one);
                }.bind(this), {});
            }
            return propsInfo.reduce(function(arr, propInfo) {
                let one = this.getInOne(propInfo, asObjectInner, handler);
                !filter
                    ? arr.push(one)
                    : _.isEmpty((_.isPlainObject(one) ? one[propInfo.propAlias] : one))
                    ? null : arr.push(one);
                return arr;
            }.bind(this), []);
        }

        /**
         * @return <Array[<String#profile]>
         */
        getServiceProfile() {
            return this.hasDef.PROP_SERVICE
                ? utils.getList(this.getManyInOne([this.info.PROP_SERVICE], false, false, false)[0], true)
                : [];
        }

        async process() {
            this._ensureInvoker();
            try {
                if (this.isOmitted()) {
                    await this._doDefault();
                    return;
                }
                this._checkFlag()
                    ._checkProperty()
                    ._checkArgs();
                await this.start();
                await this._postProcess();
            } catch(e) {
                throw new SystemError(e)
                    .withLabel(this._label || "")
                    .withLabel(this.isOmitted()
                        ? null      // tips: for /_sysvar
                        : `处理${this.option.source}特性【${this.option.fullName}】时`);
            }
        }
    };

    const handlers = new class _HandlerHelper {
        constructor() {
            this.base = HandlerBase;
            this.base.utils = this.constructor;
            this.handlersMap = new Map();
            this.featuresIndexMap = new Map();
            this.featuresList = [];
            this.forceOrders = ["log", "initvar", "_sysvar", "var", "convert"];
        }

        _getItems(featureNames) {
            !Array.isArray(featureNames) && (featureNames = [ featureNames ]);
            return featureNames.map(function(featureName) {
                return this.featuresList[this.featuresIndexMap.get(featureName)];
            }, this);
        }

        _dynamicOrders() {
            let convertHanlder = this._getItems("convert")[0][0];
            if (!convertHanlder.isDisabled()) {
                if (convertHanlder.has.FLAG_NO_HANDLE_VAR) {
                    this.forceOrders = ["log", "initvar", "convert", "_sysvar", "var"];
                }
            }
            return this.forceOrders;
        }

        _sortFeatures() {
            let defaultOrders = [...this.handlersMap.keys()],
                dynamicOrders = this._dynamicOrders(),
                orderingKeys = [...this.featuresIndexMap.keys()];
            defaultOrders.splice(0, 0, ...dynamicOrders);
            let realOrders = defaultOrders;
            return this._getItems(orderingKeys.sort(function(first, second) {
                 return realOrders.indexOf(first) - realOrders.indexOf(second);
            }.bind(this)));
        }

        _sortItems(featureItems) {
            let one = featureItems[0];
            let orderRule = one.isOmitted() ? null : one.ON_ORDERS;
            if (typeof orderRule !== "function") {
                return [featureItems];
            }

            let orders = orderRule.call(one);
            if (_.isEmpty(orders)) {
                return [featureItems];
            }

            if (!Array.isArray(orders)
                || orders.length === 0
                || !orders.every(e => Array.isArray(e)
                    && e.length > 0
                    && e.every(x => x && Object.getPrototypeOf(x) instanceof HandlerBase))) {
                throw new SystemError;
            }
            log.verbose(`计算分组内执行顺序，计算结果`, orders);
            return orders;
        }

        sort() {
            return {
                that: this,

                *[Symbol.iterator]() {
                    for (let featureItems of this.that._sortFeatures()) {
                        yield* this.that._sortItems(featureItems);
                    }
                }
            };
        }

        mergeVarSubFeatures(options) {
            const mergedItems = [...this.base._varSubFeatureNames.entries()]
            .reduce(function(items, [index, names]) {
                return names.reduce(function(items, name) {
                    if (options.hasOwnProperty(name)) {
                        options[name].forEach(function(item) {
                            item.isChild = true;
                            item.childName = item.name;
                            item.childType = index + 1;     // 从 1 开始
                            item.name = "var";
                            items.push(item);
                        });
                        delete options[name];
                    }
                    return items;
                }, items);
            }, []);
            if (mergedItems.length > 0) {
                options["var"] = options["var"] || [];
                options["var"].splice(options["var"].length, 0, ...mergedItems);
            }
            return options;
        }

        /**
         * @options: <Object[<String#name>, <Array#items>]>
         * @tokens: <Object[<String#name>, <Array#meta>]>
         */
        init(options, tokens) {
            Object.keys(this.mergeVarSubFeatures(options))
            .reduce(function(omittedSet, name) {
                if (!this.handlersMap.has(name)) {
                    throw new SystemError(`处理 ${options[name][0].source} 特性【${options[name][0].fullName}】时：未定义的特性名称：/${name}`);
                }
                this.handlersMap.get(name).setStatus(HandlerBase.STATUS_UNDETERMINED);
                this.featuresList.push(this.boxed(options[name], this.handlersMap.get(name), tokens, false));
                this.featuresIndexMap.set(name, this.featuresList.length - 1);
                omittedSet.delete(name);
                return omittedSet;
            }.bind(this), new Set(this.handlersMap.keys()))
            .forEach(function(name) {
                this.handlersMap.get(name).setStatus(HandlerBase.STATUS_OMITTED);
                this.featuresList.push(this.boxed([new OptionItem( {name: name} )], this.handlersMap.get(name), tokens, true));
                this.featuresIndexMap.set(name, this.featuresList.length - 1);
            }, this);
        }

        /**
         * @tokens: see this.init()
         */
        boxed(items, handler, tokens, _isOmitted) {
            const that = this,
                name = handler.name,
                utils = function() { return this.constructor; }.bind(this),
                tokensObj = tokens,
                handlersMap = this.handlersMap,
                featuresIndexMap = this.featuresIndexMap,
                featureRepository = {
                    get tokensObj() { return tokensObj },
                    get handlersMap() { return handlersMap; },
                    get membersIndexMap() { return featuresIndexMap; },
                    get members() { return that.featuresList; }
                },
                tokensMap = new Map(),
                itemsMap = new Map(),
                membersIndexMap = new Map(),
                siblings = {
                    get tokensMap() { return tokensMap; },
                    get itemsMap() { return itemsMap; },
                    get membersIndexMap() { return membersIndexMap; },
                    get members() { return that.featuresList[featuresIndexMap.get(name)]; }
                },
                save = function(index, item) {
                    if (_isOmitted) {
                        return true;
                    }
                    item.keyTokens.forEach(token => {
                        if (tokensMap.has(token)) {
                            const toItem = tokensMap.get(token);
                            throw new SystemError(`在处理 ${item.source} 特性【${item.fullName}】时：重复引用变量【${token}】，与 ${toItem.source} 特性【${toItem.fullName}】定义冲突`);
                        }
                        tokensMap.set(token, item);
                    });
                    itemsMap.set(item.id, item);
                    membersIndexMap.set(item.id, index);
                    return true;
                };
            return [...items.entries()].map(function([index, item]) {
                save(index, item);
                return defineReadOnly(
                    Object.setPrototypeOf(defineReadOnly({},
                        ["option", "siblings", "repository", "prototype"],
                        [item, siblings, featureRepository, handler], true), handler),
                    "utils", utils, false);
            });
        }

        add(name, handler) {
            if (this.handlersMap.has(name)) {
                throw new SystemError;
            }
            handler = handler instanceof HandlerBase ? handler : new handler();
            handler.setName(name);
            this.handlersMap.set(name, handler);
        }
    };

    handlers.add("initvar", class extends handlers.base {
        static FLAGS = {
            FLAG_DO_DELETE: ["x", ""],
            FLAG_WITH_VALUE: ["v", ""]
        };

        static ARGS = handlers.base.ANY_ARG_OPTIONAL;

        static _singleton = false;

        static _resolve_cfg = [_ResolveTypes.RESOLVE_ANY_TYPE, true, false];

        forInitia(resolved) {
            let varName = this.option.arg;
            if (varName.startsWith("{{") && varName.endsWith("}}")) {
                varName = varName.slice(2, -2);
            }
            utils.unsetVariable(varName);
            utils.setVariable(varName, resolved);
        }

        forViewOrDelete(resolved) {
            resolved = resolved.trim();
            const isRegexMode = resolved.startsWith("/") && resolved.endsWith("/");
                let pattern = null;
                try {
                    pattern = isRegexMode && eval(resolved);
                } catch(e) {}
                const userList = isRegexMode ? [] : utils.getList(resolved, true);
                const matchedVars = postman.__execution
                .environment.values
                .reduce((matches, property) => {
                    const isMatch = isRegexMode && pattern
                        ? pattern.test(property.key)
                        : (userList.includes(`{{${property.key}}}`) || userList.includes(property.key));
                    isMatch && matches.push(property.key);
                    return matches;
                }, []);
                if (this.has.FLAG_DO_DELETE) {
                    for (let name of matchedVars) {
                        utils.unsetVariable(name);
                    }
                    log.debug(`已执行变量匹配结果：${matchedVars.length} 个匹配`, matchedVars);
                    return;
                }
                console.info(`【待操作变量匹配结果：${matchedVars.length} 个匹配】`, this.has.FLAG_WITH_VALUE
                    ? new Map(matchedVars.map(name => [name, { value: utils.getVariable(name) }]))
                    : matchedVars);
                this.setExceptionLabel(null);
                throw new SystemError().withMessage(`查找到 ${matchedVars.length} 个匹配，请从Console面板中查看匹配结果`);
        }

        start() {
            return this.resolve(function(resolved) {
                if (this.option.arg != null) {
                    return this.forInitia(resolved);
                }
                return this.forViewOrDelete(resolved);
            });
        }
    });

    handlers.add("_sysvar", class extends handlers.base {
        static async ON_DEFAULT() {
            this.setExceptionLabel(`系统变量定义错误`);
            const scope = global;
            const registered = $$.sysvar.data;
            const tokensObj = this.repository.tokensObj;
            const cache = new Map();
            for (const name in tokensObj) {
                if (!/^__([a-zA-Z_0-9]+)\.(.+)__$/.test(name)) {
                    continue;
                }
                const attr = RegExp.$1, restAttrExpr = RegExp.$2;
                if (!registered.hasOwnProperty(attr)) {
                    continue;
                }
                const func = registered[attr];
                this.setExceptionLabel(`系统变量【${name}】定义/计算错误`)
                log.debug(`开始计算系统变量【${name}】`);
                const topObj = cache.has(attr)
                    ? cache.get(attr)
                    : cache.set(attr, func.call(scope)).get(attr);
                let result = await this._chainsGetObj(attr, restAttrExpr, topObj);
                if (result instanceof SendResult) {
                    result = result.data;
                }
                this.verify(result);
                log.debug(`系统变量计算结果【${name}】`, result);
                utils.setVariable(name, result);
            }
        }

        splitAttr(attrExpr) {
            return attrExpr.split(".").reduce((context, attr, idx, src) => {
                if (context.actived) {
                    if (attr.endsWith(context.spR)) {
                        context.attrs.push(context.prefix + attr.slice(0, -1));
                        return Object.assign(context, { actived: false, prefix: "", spL: "", spR: "" });
                    }
                    if (idx === src.length - 1) {
                        throw new SystemError(`属性表达式不正确，在【${attr}】附近`, attrExpr);
                    }
                    return (context.prefix += (attr + ".")), context;
                }
                const spPos = context.separators[0].indexOf(attr[0]);
                if (spPos !== -1) {
                    const spL = context.separators[0][spPos], spR = context.separators[1][spPos];
                    if (attr.endsWith(spR)) {
                        return context.attrs.push(attr.slice(1, -1)), context;
                    }
                    if (idx === src.length - 1) {
                        throw new SystemError(`属性表达式不正确，在【${attr}】附近`);
                    }
                    return Object.assign(context, { actived: true, prefix: attr.slice(1) + ".", spL: spL, spR: spR });
                } else
                if (!/^[a-zA-Z-_$0-9]+$/.test(attr)) {
                    throw new SystemError(`属性表达式不正确，在【${attr}】附近`, attrExpr);
                }
                return context.attrs.push(attr), context;
            }, { separators: ["([{<", ")]}>"], attrs: [] }).attrs;
        }

        async _chainsGetObj(topAttr, restAttrExpr, topObj) {
            return await this.splitAttr(restAttrExpr)
            // tips: .reduce(async ....) 这里会访问返回对象的`then`属性，如果要访问的属性是一个proxy，由于重复访问proxy的getter，可能导致重复运行getter里面原本并不期望重复运行的代码。因此，在proxy中要确保正确的处理`then`属性的访问。见 cteateProxyObject()
            .reduce(async (obj, attr, idx, src) => {
                let t = utils.getType(obj), isPromise = t === '[object Promise]';
                if (isPromise) {
                    obj = await obj;
                    t = utils.getType(obj);
                }
                const isObject = t === '[object Object]',
                    isMap = t === '[object Map]';
                if (!isObject && !isMap) {
                    throw new SystemError(`在访问中间属性【${topAttr}.${src.slice(0, idx + 1).join(".")}】时，其返回的数据类型(${isPromise ? `${t}(Promsie)` : t})不是受支持的对象类型(<Object/Map/Proxy>)`);
                }
                if (!(isMap ? obj.has(attr) : attr in obj)) {
                    throw new SystemError(`在访问中间属性【${topAttr}.${src.slice(0, idx + 1).join(".")}】时，未找到该属性【${attr}】，可能是未定义/定义有误/访问错误`);
                }
                const currentObj = isObject ? obj[attr] : obj.get(attr);
                const currentType = utils.getType(currentObj);
                if (currentType === '[object Promise]') {
                    return await currentObj;
                }
                return currentObj;
            }, topObj);
        }

        verify(result) {
            if (typeof result !== "string") {
                throw new SystemError(`计算结果不是字符串类型：【${utils.getType(result)}】`, result);
            }
            if (!result.trim()) {
                throw new SystemError(`计算结果为空：【${result}】`, result);
            }
        }

        start() {
            throw new SystemError(`特性【/${this.name}】不需要显式定义`);
        }
    });

    handlers.add("var", class extends handlers.base {
        static ON_ORDERS() {
            let {tokensMap, itemsMap, membersIndexMap, members} = this.siblings;
            let referedLevelObj = {}, referedObj = {}, dependentObj = {};
            if (itemsMap.size === 0) {
                return [];
            }
            for (let [itemId, item] of itemsMap) {
                for (let valueToken of item.valueTokens) {
                    if (tokensMap.has(valueToken)) {
                        let refercedItem = tokensMap.get(valueToken);
                        if (refercedItem.id === item.id) {
                            if (refercedItem.keyTokens.has(valueToken)) {
                                throw new SystemError(`${refercedItem.source}特性【${refercedItem.fullName}】变量【${valueToken}】存在自依赖关系：禁止自依赖`);
                            }
                            continue;
                        }
                        if (utils.setIntersection(refercedItem.valueTokens, item.keyTokens).size > 0) {
                            throw new SystemError(`${refercedItem.source}特性【${refercedItem.fullName}】与 ${item.source}特性【${item.fullName}】之间，变量【${valueToken}】引用存在相互依赖关系：禁止相互依赖`, refercedItem, item);
                        }

                        let refId = refercedItem.id, referedTokens = refercedItem.keyTokens, dependTokens = item.keyTokens;
                        referedLevelObj[refId] = referedLevelObj[refId] || 1;

                        referedTokens.forEach(referedToken => {
                            referedObj[referedToken] = referedObj[referedToken] || new Set();
                            referedObj[referedToken].add(itemId);
                        });

                        dependTokens.forEach(dependToken => {
                            dependentObj[dependToken] = dependentObj[dependToken] || new Set();
                            dependentObj[dependToken].add(refId);
                            if (referedObj[dependToken]) {
                                referedLevelObj[refId] += 1;
                            }
                        });

                        if (dependentObj[valueToken]) {
                            for (let _itemId of dependentObj[valueToken]) {
                                referedLevelObj[_itemId] += 1;
                            }
                        }
                    }
                }
            }

            log.verbose("计算分组内执行顺序，元数据", {
                referedLevelObj: referedLevelObj,
                referedObj: referedObj,
                dependentObj: dependentObj
            });
            for (let itemId of itemsMap.keys()) {
                if (!referedLevelObj.hasOwnProperty(itemId)) {
                    referedLevelObj[itemId] = 0;
                }
            };
            let transposed = _.transform(referedLevelObj, function(obj, level, itemId) {
                (obj[level] || (obj[level] = [])).push(members[membersIndexMap.get(itemId)]);
            }, {});
            let ordered = Object.keys(transposed).sort((a, b) => Number(b) - Number(a));
            return ordered.map(level => transposed[level]);
        }

        static FLAGS = {
            FLAG_CLEAR_BEFORE: ["c", ``],
            FLAG_STATIC: ["s", ``],
            FLAG_ENUM: ["E", ``],
            FLAG_RANGE: ["R", ``],
            FLAG_SCRIPT: ["x", ""]
        };

        // TODO 所有属性定义改为 [名称，别名，值类型，值是否允许包含变量，是否允许行内定义， ....]
        static PROPERTIES = {
            PROP_VAR_DISABLE: ["disable", `disable property`],
            PROP_SERVICE: ["service.profile", "", "service"],
            // 语言
            PROP_SCRIPT_JS: ["script.js", "", "js"],
            PROP_SCRIPT_PHP: ["script.php", "", "php"],
            PROP_SCRIPT_PYTHON: ["script.python", "", "python"],
            PROP_SCRIPT_NODEJS: ["script.nodejs", "", "nodejs"],
            PROP_SCRIPT_SHELL: ["script.shell", "", "shell"],
            PROP_SCRIPT_WINCMD: ["script.wincmd", "", "wincmd"],
            PROP_SCRIPT_POWERSHELL: ["script.powershell", "", "powershell"],
            PROP_SCRIPT_GITBASH: ["script.gitbash", "", "git-bash"],
            PROP_SCRIPT_WSLBASH: ["script.wslbash", "", "wsl-bash"],
            // 自由命令行模式
            PROP_SCRIPT_GENERIC: ["script.generic", "", "generic"],
            // 结果处理程序
            PROP_POSTSCRIPT_TRIM: ["post.trim", "", "trim", true],
            PROP_POSTSCRIPT_EXEC: ["post.exec", "", "post", false],
            // 中间件
            PROP_M_SERVICE: ["middleware.service.profile", "", "mservice"],
            PROP_MIDDLEWARE_MYSQL: ["middleware.mysql", "", "mysql", ],
            PROP_MIDDLEWARE_MONGODB: ["middleware.mongodb", "", "mongodb", ],
            PROP_MIDDLEWARE_REDIS: ["middleware.redis", "", "redis", ],
            PROP_MIDDLEWARE_ELASTIC: ["middleware.elastic", "", "elastic", ]
        };

        static ARGS = handlers.base.ANY_ARG_REQUIRED;

        static _singleton = false;

        static _resolve_cfg = [_ResolveTypes.RESOLVE_ANY_TYPE, false, false];

        /**
         * example:
         * a, b, c          => usually expression
         * a, b c, d        => the element value contians space
         * {{$randomFirstName}}, hello      => work with variable
         */
        randomizeEnum(expr) {
            let enums = utils.getList(expr, false);
            if (!enums.length) {
                throw new SystemError(`枚举型表达式为空`);
            }

            let selected = utils.randomList([...enums]);
            return selected;
        }

        /**
         * example:
         * 1-9            => random int
         * 1.00-2.00      => random float
         * [1-9]          => random with 'inclusive' flag
         * (1.1-2.222)    => random with 'exclusive' flag
         * (1-9           => the left/right flag can be omitted
         * ( 1.5 -  9 ]   => space is allow in each range expression
         * 1-9, [20.01-20.99)       => conbine multi ranges
         * 1.00 - 5.00, 7.0, 9      => work with precise number
         * {{$randomInt}}-10000     => work with variable
         */
        randomizeRange(multiExpr) {
            multiExpr = utils.resolveScalar(multiExpr);   // 隐式实现 FLAG_STATIC
            let exprs = new Set(multiExpr.split(/\s*[,，]\s*/g));
            if (!exprs.size) {
                throw new SystemError(`数字区间型表达式为空`);
            }

            let values = [...exprs].map(function (expr) {
                if (utils.matchNumSpec(expr, false)) {
                    return expr;
                }
                let selected = utils.randomNumber(expr);
                if (isNaN(selected)) {
                    throw new SystemError(`生成随机数字失败, 请重试一次`);
                }
                return selected;
            }, this);
            let selected = utils.randomList(values);
            return selected;
        }

        setVar(asyncValue=null) {
            if (asyncValue) {
                // tips: 脚本执行结果始终保存到空环境变量 {{}}（{{}} 对postman而言是合法的环境变量，注意，中间不能包含任何空格，否则就属于另外一个变量了）
                utils.setVariable("", asyncValue);
                // tips: 行内属性表达式规则：如果文本中出现了空属性（即界定符之间没有名称，eg：【】表示一个空属性），表示中断属性表达式，其后的文本内容被认为是普通文本，且为字段的值的一部分，之所以说是“一部分”，是因为有一个变量替换规则：即该文本中的 {{}} 变量将被替换为脚本/命令的执行结果。eg: 【js】+new Date() 【】当前时间：{{}}，执行结果将为“当前时间：xxxxxxx”
                this.value = this._value == null || this.option.isChild
                    // 使用简化方法定义脚本命令/中间件任务时，空变量 {{}} 含义有所不同：
                    //   非简化方式：空变量将使用执行结果替换
                    //   简化方式：空变量为普通变量，不会使用执行结果替换
                    // 另见 this.getInline()
                    ? asyncValue
                    : this._value.replace(/\{\{\}\}/g, asyncValue);
            }
            if (this.has.FLAG_STATIC) {
                this.value = utils.resolveScalar(this.value);
            }
            if (this.has.FLAG_ENUM) {
                this.value = this.randomizeEnum(this.value);
            } else {
                if (this.has.FLAG_RANGE) {
                    this.value = this.randomizeRange(this.value);
                }
            }
            const variableName = this.option.arg;
            if (!variableName == null || utils.hasToken(variableName)) {
                throw new SystemError;
            }
            if (this.has.FLAG_CLEAR_BEFORE) {
                utils.unsetVariable(variableName);
            }
            utils.setVariable(variableName, this.value);
        }

        getMiddlewareProfileNames() {
            return utils.getList(this.getManyInOne([this.info.PROP_M_SERVICE], false, false, false)[0], true);
        }

        getMiddlewareProfileConfs(middlewareName, profileNames) {
            if (profileNames.length === 0) {
                profileNames = ["default"];
            }
            const configs = this.configGet(Object, `remote.middlewares.${middlewareName}`);
            return profileNames.map(function(name) {
                if (name === "default" && _.isString(configs[name])) {
                     const value = configs[name].trim();
                     value.startsWith("@") && (name = value.substring(1));
                }
                if (!configs.hasOwnProperty(name) || !_.isPlainObject(configs[name])) {
                    throw new SystemError(`未定义的中间件配置：【${name}】，或其值不是对象类型`);
                }
                return configs[name];
            }, this);
        }

        getLanguageConfs(langNames) {
            const configs = this.configGet(Object, `remote.executor`);
            return langNames.map(function(name) {
                if (!configs.hasOwnProperty(name) || !_.isPlainObject(configs[name])) {
                    throw new SystemError(`未定义的脚本语言：【${name}】，或其值不是对象类型`);
                }
                return configs[name];
            }, this);
        }

        postProcess(result) {
            const a = this.info.PROP_POSTSCRIPT_EXEC, b = this.info.PROP_POSTSCRIPT_TRIM;
            const postProcessor = this.getManyInOne([a, b], true, true, true);
            if (postProcessor[a.propAlias] && postProcessor[b.propAlias]) {
                throw new SystemError(`不能同时设置多个后置处理任务：【${a.propAlias}】【${b.propAlias}】`);
            }
            if (postProcessor[a.propAlias]) {
                throw new SystemError(`、【${a.propAlias}】属性：暂未实现`);
            }
            if (postProcessor[b.propAlias]) {
                return result.trim();
            }
            return result;
        }

        async execScript() {
            const languages = Object.entries(this.getManyInOne(
                this.getInfosByPattern("PROP_SCRIPT_*", "PROP_MIDDLEWARE_"), true, true, false));
            if (!languages.length) {
                throw new SystemError(`未指定脚本语言或中间件名称`);
            }
            if (languages.length > 1) {
                throw new SystemError(`不能同时定义多个脚本/中间件任务，或同时定义两者: "${languages.map(e => e[0])}"`);
            }
            const [language, script] = languages[0];
            const cfg = {
                profile: this.getServiceProfile(),      // <String>
                directReturn: true,
                validator: function(data) {
                    if (typeof data !== "string") {
                        throw new SystemError(`代码执行结果不是字符串类型. type: ${utils.getType(data)}`);
                    }
                    if (!data.trim()) {
                        log.warn(`代码执行结果返回空文本："${data}"`);
                    }
                }
            };
            if (this.C._varSubFeatureNames[1].includes(language)) {
                // 仅在需要发送中间件配置时添加该属性，Executor.run() 中将利用该属性判断
                const mProfileNames = this.getMiddlewareProfileNames();
                const mProfileConfs = this.getMiddlewareProfileConfs(language, mProfileNames);
                cfg.middlewareProfile = mProfileConfs[0];
            } else {
                const executorConfs = this.getLanguageConfs([language]);
                cfg.executorProfile = executorConfs[0];
            }
            const executor = new Executor(language, cfg, this.name);
            const result = await executor.run(utils.resolveScalar(script)).getResult();
            return this.postProcess(result);
        }

        async start() {
            if (this.option.isChild) {
                this.getInline();
                this._inlineData[this.option.childName] = this.value;   // 应使用 this.value 而不是 this._value
                this.option.flag += "x";
            }
            return this.resolve(async function(resolved) {
                this.setVar(this.has.FLAG_SCRIPT ? await this.execScript() : null);
            });
        }
    });

    handlers.add("doc", class extends handlers.base {
        static _resolve_cfg = [_ResolveTypes.RESOLVE_ANY_TYPE, true, false];

        start() {
            return this.resolve(function(resolved) {
                return pm.visualizer.set($$.doc.data);
            });
        }
    });

    handlers.add("log", class extends handlers.base {
        static ON_DEFAULT = () => {};

        static _resolve_cfg = [_ResolveTypes.RESOLVE_LOGLEVEL_TYPE, true, false];

        start() {
            return this.resolve(function(resolved) {
                // tips: 参见 _toPreProcess()
                return;
            });
        }
    });

    handlers.add("debug", class extends handlers.base {
        static ON_DEFAULT() {
            const remoteTarget = utils.getRemoteTarget(false);
            if (remoteTarget) {
                const originUrl = this.configGet(String, `local.domains.${remoteTarget}.origin`);
                return remoteTarget && utils.setVariable(remoteTarget, originUrl);
            }
        }

        static PROPERTIES = {
            PROP_URL: ["url", "the debugging url"],
            PROP_ORIGIN: ["origin", "the origin url"],
            PROP_COOKIES_REQUIRED_KEYS: ["sharedCookies.requiredSyncKeys", ""],
            PROP_COOKIES_OPTIONAL_KEYS: ["sharedCookies.optionalSyncKeys", ""],
            PROP_COOKIES_CASE_SENSITIVE: ["sharedCookies.caseSensitive", ""]
        };

        static _resolve_cfg = [_ResolveTypes.RESOLVE_BOOLEAN_TYPE, false, true];

        getShareCfg(remoteTarget) {
            const enabled = this.configGet(Boolean, `local.domains.${remoteTarget}.sharedCookies.enabled`, true);
            const caseSensitive = this.has.PROP_COOKIES_CASE_SENSITIVE
                ? _ResolveTypes.RESOLVE_BOOLEAN_TYPE({ value: this.get.PROP_COOKIES_CASE_SENSITIVE.value })
                : this.configGet(Boolean, `local.domains.${remoteTarget}.sharedCookies.caseSensitive`, true);
            const syncRequired = this.has.PROP_COOKIES_REQUIRED_KEYS
                ? utils.getList(this.get.PROP_COOKIES_REQUIRED_KEYS.value, true)
                : this.configGet(Array, `local.domains.${remoteTarget}.sharedCookies.requiredSyncKeys`, []);
            const syncOptional = this.has.PROP_COOKIES_OPTIONAL_KEYS
                ? utils.getList(this.get.PROP_COOKIES_OPTIONAL_KEYS.value, true)
                : this.configGet(Array, `local.domains.${remoteTarget}.sharedCookies.optionalSyncKeys`, []);
            return [enabled, caseSensitive,
                new Set(caseSensitive ? syncRequired : syncRequired.map(e => e.toLowerCase())),
                new Set(caseSensitive ? syncOptional : syncOptional.map(e => e.toLowerCase()))];
        }

        getDebugUrl(remoteTarget) {
            return this.has.PROP_URL
                ? this.get.PROP_URL.value
                : this.configGet(String, `local.domains.${remoteTarget}.debug`);
        }

        getOriginUrl(remoteTarget) {
            return this.has.PROP_ORIGIN
                ? this.get.PROP_ORIGIN.value
                : this.configGet(String, `local.domains.${remoteTarget}.origin`);
        }

        updateOneCookie(cookie, newDomain) {
            return Object.assign(new sdk.Cookie(cookie.toJSON()), {
                domain: newDomain,
                expires: null,
                maxAge: 1
            });
        }

        setOneCookie(cookie, debugUrl) {
            const domainNew = utils.toUrl2(debugUrl).getHost();
            const cookieNew = this.updateOneCookie(cookie, domainNew);
            return utils.setCookie(debugUrl, cookieNew);
        }

        async shareCookies(remoteTarget, originUrl, debugUrl) {
            const [enabled, caseSensitive,
                syncRequiredSet, syncOptionalSet] = this.getShareCfg(remoteTarget);
            if (!enabled || (syncRequiredSet.size === 0 && syncOptionalSet.size === 0)) {
                return;
            }
            return utils.getAllCookies(originUrl).then(async(cookies) => {
                const syncedCookies = [], knownCookieNames = [];
                await cookies.reduce(async(syncedInfos, cookie) => {
                    const keyName = caseSensitive ? cookie.name : cookie.name.toLowerCase();
                    if (syncRequiredSet.has(keyName)) {
                        await this.setOneCookie(cookie, debugUrl);
                        syncedInfos[0].delete(keyName);
                        syncedInfos[2].push(cookie);
                    } else
                    if (syncOptionalSet.has(keyName)) {
                        await this.setOneCookie(cookie, debugUrl);
                        syncedInfos[1].delete(keyName);
                        syncedInfos[2].push(cookie);
                    }
                    knownCookieNames.push(cookie.name);
                    return syncedInfos;
                }, [syncRequiredSet, syncOptionalSet, syncedCookies]);
                const extraInfo = { origin: originUrl, target: debugUrl };
                if (syncOptionalSet.size > 0) {
                    log.warn(`以下指定可选同步的cookie未同步(caseSensitive=${caseSensitive})：【${[...syncOptionalSet.keys()]}】`, extraInfo);
                }
                if (syncRequiredSet.size > 0) {
                    throw new SystemError(`以下指定必须同步的cookie未同步(caseSensitive=${caseSensitive})：【${[...syncRequiredSet.keys()]}】，已知列表：[${knownCookieNames.join(", ")}]`, extraInfo);
                }
                log.info( `已同步 ${syncedCookies.length} 个cookie`, syncedCookies, extraInfo);
            });
        }

        async start() {
            return this.resolve(async function(resolved) {
                if (!resolved) {
                    const remoteTarget = utils.getRemoteTarget(false);
                    if (!remoteTarget) {
                        return;
                    }
                    const originUrl = this.getOriginUrl(remoteTarget);
                    return utils.setVariable(remoteTarget, originUrl);
                }
                const remoteTarget =  utils.getRemoteTarget(true);
                const debugUrl = utils.resolveScalar(this.getDebugUrl(remoteTarget));
                const originUrl = utils.resolveScalar(this.getOriginUrl(remoteTarget));
                utils.setVariable(remoteTarget, debugUrl);
                await this.shareCookies(remoteTarget, utils.resolveScalar(originUrl), utils.resolveScalar(debugUrl));
            });
        }
    });

    handlers.add("convert", class extends handlers.base {
        static FLAGS = {
            FLAG_STATIC: ["s", "resolve variables before convert"],
            FLAG_INVERT: ["v", "treat number as string type"],
            FLAG_NO_DETECT_SERVICE: ["S", "disable auto detect service"],
            FLAG_NO_HANDLE_VAR: ["F", "don't handle /var feature"],
            FLAG_NO_RECYCLE: ["R", "disable recycle convert"]
        };

        static PROPERTIES = {
            PROP_KEYS_WHITE: ["keys.white", "", "white"],
            PROP_KEYS_FORCE: ["keys.force", "", "force"],
            PROP_KEYS_ARRAY: ["keys.array", "", "array"],
            PROP_KEYS_JSON: ["keys.json", "", "json"],
            PROP_KEYS_NULL: ["keys.null", "", "null"],
            PROP_KEYS_EMPTY: ["keys.empty", "", "empty"],
            PROP_KEYS_ZERO: ["keys.zero", "", "zero"],
            PROP_KEYS_STATIC: ["keys.nostatic", "", "nostatic"],
            PROP_SERVICE: ["service.profile", "", "service"]
        };

        static _pre_get_inline = true;

        static _resolve_cfg = [_ResolveTypes.RESOLVE_CONVERT_FORMAT_TYPE, true, false];

        static _recycle_rules = new Map([
            ["json", ["form", "plain"]],
            ["form", ["json", "urlencoded"]],
            ["url", ["form", "json"]],
            ["urlencoded", []],
            ["urldecoded", []],
            ["plain", []],
        ]);

        _protect_newline_char(value) {
            /** tips:
             * 需要对参数值中可能包含的换行符进行处理，使能够在 Bulk Edit 中正确解析
             *  - \r\n 及 \n 替换为码点为8629的字符；单独的 \r 删除
             *  - \t、\f \v 无影响
             */
            return value.replace(/\r?\n|\r/g, (match) => {
                return match === "\r" ? "" : String.fromCodePoint(8629);
            });
        }

        /**
         * @placeHolder
         * @whiteKeys: <Array[keyName]>
         * @invert: <Boolean>
         * @forceKeys: <Array[keyName]>
         * @arrayKeys: <Array[<Array[seperator, keyName]>]>
         * @jsonKeys: <Array[keyName]>
         * @nullKeys: <Array[keyName]>
         * @emptyKeys: <Array[keyName]>
         * @zeroKeys: <Array[keyName]>
         */
        _tool_convertForm2JsonParams(formdata, placeHolder, whiteKeys=[], invert=false,
            forceKeys=[], arrayKeys=[], jsonKeys=[], nullKeys=[], emptyKeys=[], zeroKeys=[]) {
            class paramConflictError extends TypeError {
                constructor(key, type, combinations) {
                    super();
                    this.message = `转换异常场景${type}：字段的键存在冲突：请检查键"${key}"是否存在以下非法组合场景之一：${combinations.flatMap(a => a.join("   .vs.   ")).join("      或\n    ")}\n`;
                }
            };
            let result = utils.correctUndefinedIndexes((formdata)
            .sort().reverse()
            .reduceRight(function(obj, property, idx, src) {
                let {key, type, value} = property;
                key = key.trim();     // trim any space
                let isNumeric = utils.matchNumSpec(value, false),
                    isWhiteKeys = whiteKeys.length, wKeysInclusive = isWhiteKeys && whiteKeys.includes(key),
                    isResolvedNumeric = value.includes("{{") && (utils.matchNumSpec(utils.resolveScalar(value), false));
                switch (true) {
                    case isNumeric && !isWhiteKeys && !invert:
                    case isNumeric && (isWhiteKeys && wKeysInclusive) && !invert:
                    case isNumeric && (isWhiteKeys && !wKeysInclusive) && invert:
                        value = Number(value);
                        break;
                    case isResolvedNumeric && !isWhiteKeys && !invert:
                    case isResolvedNumeric && (isWhiteKeys && wKeysInclusive) && !invert:
                    case isResolvedNumeric && (isWhiteKeys && !wKeysInclusive) && invert:
                        value = placeHolder + value;
                        break;
                    default:
                        let isArrayKeys = arrayKeys.length, aKeyConfig = [null, null],
                            aKeysInclusive = isArrayKeys && arrayKeys.some(c => {
                                if (c[1] === key) {
                                    aKeyConfig = c;
                                    return true;
                                };
                                return false;
                            }),
                            isJsonKeys = jsonKeys.length, jKeysInclusive = isJsonKeys && jsonKeys.includes(key),
                            isNullKeys = nullKeys.length, nKeysInclusive = isNullKeys && nullKeys.includes(key),
                            isEmptyKeys = emptyKeys.length, eKeysInclusive = isEmptyKeys && emptyKeys.includes(key),
                            isZeroKeys = zeroKeys.length, zKeysInclusive = isZeroKeys && zeroKeys.includes(key);
                        if ([nKeysInclusive, eKeysInclusive, zKeysInclusive].filter(e => e).length > 1) {
                            throw new SystemError(`该键不能同时出现在互斥的特性属性（null/empty/zero）之中："${key}"`);
                        }
                        if ([aKeysInclusive, jKeysInclusive].filter(e => e).length > 1) {
                            throw new SystemError(`该键不能同时出现在互斥的特性属性（array/json）之中："${key}"`);
                        }
                        if (isArrayKeys && aKeysInclusive) {
                            // TODO property flag ???
                            value = utils.getList(aKeyConfig[0] + value, false).map(e => {
                                return /^[^-0-9]/.test(e) ? e : isNaN(Number(e)) ? e : Number(e);
                            });
                        }
                        if (isJsonKeys && jKeysInclusive && value) {
                            try {
                                value = JSON.parse(value);
                                log.info(`该字段值是一个有效的JSON："${key}"`, value);
                            } catch (e) {
                                try {
                                    value = JSON.parse(value.replace(/\\/g, ""));
                                } catch (nil) {
                                    throw new SystemError(e).withLabel(`发现该字段值不是有效的JSON："${key}"`);
                                }
                            }
                        }
                        if ((_.isArray(value) && !value.length) ||
                            (_.isPlainObject(value) && !Object.keys(value).length) ||
                            [null, undefined, NaN, ""].includes(value)) {
                            isNullKeys && nKeysInclusive && (value = null);
                            isEmptyKeys && eKeysInclusive && (value = "");
                            isZeroKeys && zKeysInclusive && (value = 0);
                        }
                        break;
                }
                if (type === "file") {
                    return src.pop(), obj;     // skip file param
                }
                let items = [...key.matchAll(/^(?<prefix>[^\[\]]+)|\[(?<part>[^\[\]]*)\]/g)];
                if (!items.length) {
                    throw new SystemError(`发现不支持转换的字段键名: ${key}`);        // key === "[name", for example
                }
                return items.reduce(function(_obj, _match, _idx, _src) {
                    let currentKey = _match.groups.prefix || _match.groups.part,
                        currentIndex = /^[0-9]+$/.test(key) ? NaN : +currentKey,
                        currentIsObj = isNaN(currentIndex),
                        currentIsArray = !currentIsObj,
                        nextKey = null,
                        nextIndex = null,
                        nextIsObj = null,
                        nextIsArray = null,
                        isArray = Array.isArray(_obj),
                        isObj = _.isPlainObject(_obj);
                    if (currentIsArray && (!Number.isSafeInteger(currentIndex) || currentIndex < 0)) {
                        throw new SystemError(`在字段"${key}"中发现无效的索引数字：${currentIndex}`);
                    }
                    if (_idx < _src.length - 1) {
                        nextKey = _src[_idx + 1].groups.part;
                        nextIndex = +nextKey;
                        nextIsObj = isNaN(nextIndex);
                        nextIsArray = !nextIsObj;
                    }
                    switch (true) {
                        case isObj && currentIsObj && nextIsObj:
                            if (_obj[currentKey] && !_.isPlainObject(_obj[currentKey])) {
                                let combinations = [
                                    ["[name]", "[name][age]"],
                                    ["name", "name[age]"],
                                    ["name[]", "name[age]"]];
                                throw new paramConflictError(key, 1, combinations);
                            }
                            _obj[currentKey] = _obj[currentKey] || {};
                            return _obj[currentKey];
                        case isObj && currentIsObj && nextIsArray:
                            if (_obj[currentKey] && !Array.isArray(_obj[currentKey])) {
                                let combinations = [
                                    ["[name]", "[name][]"],
                                    ["name", "name[]"]];
                                throw new paramConflictError(key, 2, combinations);
                            }
                            _obj[currentKey] = _obj[currentKey] || Array.from(nextIndex + 1);
                            return _obj[currentKey];
                        case isObj && currentIsObj && nextKey === null:
                            if (_obj.hasOwnProperty(currentKey)) {
                                let combinations = [["name", "name"]];
                                throw new paramConflictError(key, 3, combinations);
                            }
                            _obj[currentKey] = value;
                            return obj;
                        case isArray && currentIsArray && nextIsObj:
                            _obj[currentIndex] = _obj[currentIndex] || {};
                            return _obj[currentIndex];
                        case isArray && currentIsArray && nextIsArray:
                            let _val = Array.from(nextIndex + 1);
                            _obj[currentIndex] = _obj[currentIndex] || _val;
                            return _obj[currentIndex];
                        case isArray && currentIsArray && nextKey === null:
                            if (currentIndex === 0 && !currentKey) {
                                _obj.push(value);
                            } else {
                                _obj[currentIndex] = value;
                            }
                            return obj;
                        case (isArray && currentIsObj):
                            let combinations = [
                                ["[]", "[name]"],
                                ["name", "[name]"],
                                ["name[][]", "name[][age]"]];
                            throw new paramConflictError(key, 4, combinations);
                        case (isObj && currentIsArray):
                            if (idx !== 1) {
                                let combinations = [[]];
                                throw new paramConflictError(key, 5, combinations);
                            }
                            obj = Array.from(currentIndex + 1);
                            obj[currentIndex] = value;
                            return obj;
                        default:
                            combinations = [[]];
                            throw new paramConflictError(key, 6, combinations);
                    }
                }, obj);
            }, {}));
            return JSON.stringify(result, function(key,value) {
                if (typeof value === "string") {
                    if (forceKeys.includes(key)) {
                        let hasToken = utils.hasToken(value),
                            isReplaced = value.startsWith(placeHolder);
                        if (hasToken && !isReplaced) {
                            return placeHolder + value;
                        }
                    }
                }
                return value;
            }).replace(new RegExp(String.raw`"${placeHolder}(.*?(?<!\\))"`, "g"), "$1");
        }

        _tool_convertJson2FormParams(jsonParamsObj) {
            function _deal(obj, out, path, _depth=0) {
                if (Array.isArray(obj)) {
                    if (!obj.length) {
                        out.set(path, "");
                    }
                    for (let [index, elemObj] of obj.entries()) {
                        path = index > 0
                            ? path.replace(/\[[^\[\]]+\]$/, `[${index}]`)
                            : `${path}[${index}]`;
                        _deal(elemObj, out, path, _depth + 1);
                    };
                } else
                if (_.isPlainObject(obj)) {
                    let keys = Object.keys(obj);
                    if (!keys.length) {
                        out.set(path, "");
                    }
                    for(let [index, key] of keys.entries()) {
                        path = _depth === 0 ? key : index > 0
                            ? path.replace(/\[[^\[\]]+\]$/, `[${key}]`)
                            : `${path}[${key}]`;
                        _deal(obj[key], out, path, _depth + 1);
                    }
                } else {
                    out.set(path, [null, undefined, NaN, ""].includes(obj) ? "" : obj);
                }
            }
            let dataMap = new Map();
            _deal(jsonParamsObj, dataMap, "");
            return [...dataMap].reduce(function(result, [key, value]) {
                // value = _.isString(value)
                //     /** tips:
                //      * 需要对请求参数值中可能包含的换行符进行处理，使能够在 Bulk Edit 中正确解析
                //      *  - 同时影响 \r\n 以及 \n
                //      *  - \r、\t、\f 等不受影响
                //      */
                //     ? value.replace(/\r?\n/g, String.fromCodePoint(8629))
                //     : value.toString();
                key = this._protect_newline_char(this.has.FLAG_STATIC
                    ? utils.resolveScalar(key)
                    : key);
                value = _.isString(value)
                    ? this._protect_newline_char(this.has.FLAG_STATIC
                        ? utils.resolveScalar(value)
                        : value)
                    : value.toString();
                result += `\n${key}:${value}`;
                return result;
            }.bind(this), "");
        }

        _tool_patchJsonObjectValueUnQuoteVariables(formattedText, _usePlaceHolder) {
            // tips: 增加placeholder进行标识，便于在后续的处理中进行还原替换
            let placeHolder = _usePlaceHolder ? String.fromCodePoint(127) : "",
                pattern = /(?<prefix>"\s*:\s*)(?<unQuoteValue>[^"]+?)(?<suffix>\s*(,\s*)?\n)/g,
                replaceCount = 0;
            let result = formattedText.replace(pattern, function(match, ...args) {
                let {prefix, unQuoteValue, suffix} = args[args.length - 1];
                let hasToken = utils.hasToken(unQuoteValue);
                hasToken && (replaceCount += 1)
                return hasToken
                    ? `${prefix}"${placeHolder}${unQuoteValue}${placeHolder}"${suffix}`
                    : match;
            });
            return _usePlaceHolder ? [result, replaceCount > 0 ? placeHolder : null] : result;
        }

        // tips: 设计该函数的目的主要是为了兼容不常规的变量定义（指包含非identifier字符，eg: {{ }}, {{a+b}} ），代价是增加了一定的复杂度
        _restore_token_metachar(source, textUriCoded, fn) {
            utils.getVariableTokens(source, false, false)
            .forEach(token => {
                var token = "{{" + token +"}}", tokenUriCoded = fn(token);
                // tips: postman中暂不支持 String.prototype.replaceAll() 方法
                for (; textUriCoded.includes(tokenUriCoded); ) {
                    if (tokenUriCoded === token) {
                        break;      // tips: 防止死循环
                    }
                    textUriCoded = textUriCoded.replace(tokenUriCoded, token);
                }
            });
            return textUriCoded;
        }

        _property_pair_common(property, fn) {
            const [key, value] = [property.key, property.value].map(e => {
                return e === null ? "" : typeof e !== "string" ? e.toString() : e;
            });
            const that = this,
                pairCoded = this.has.FLAG_STATIC
                    ? [key, value].map(e => {
                        const resolved = utils.resolveScalar(e);
                        /** tips:
                         * 即使特性中定义了 static 标记，对于未定义的变量，变量替换结果中依然会保留该未定义的变量。这增加了一定的复杂度
                         * bugs: 由此引发出一个歧义点：设定了 static 标记，同时变量的值刚好又包含了 token 标识，那么将其当作变量还是纯量？
                         * TODO: 当前机制是按变量处理。若要对此区分，可以考虑做成配置项。
                         * 实际应用中这个场景应该估计是非常小的，因为这种参数通常都相对简单
                         */
                        return that._restore_token_metachar(resolved, fn(resolved), fn);
                    }).join("=")
                    : [key, value].map(e => fn(e)).join("=");
            return this._restore_token_metachar(`${key}=${value}`, pairCoded, fn);
        }

        _property_no_uricoded(property) {
            return this._property_pair_common(property, (e) => e);
        }

        _property_urlencoded(property) {
            return this._property_pair_common(property, global.encodeURIComponent);
        }

        _property_urldecoded(property) {
            return this._property_pair_common(property, global.decodeURIComponent);
        }

        _converter_form_to_uricommon(fn, _alternativeFormData=null) {
            return (_alternativeFormData || this.getFormParams(false))
            .reduce(function(result, property, index) {
                return result += ((index === 0 ? "" : "&") + fn.call(this, property));
            }.bind(this), "");
        }

        converter_form_to_json(_alternativeFormData=null) {
            const invert = this.has.FLAG_INVERT;
            const placeHolder = String.fromCodePoint(127);
            let [whiteKeys, forceKeys, arrayKeys, jsonKeys, nullKeys,
                emptyKeys, zeroKeys, staticKeys] = this.getManyInOne([
                this.info.PROP_KEYS_WHITE,
                this.info.PROP_KEYS_FORCE,
                this.info.PROP_KEYS_ARRAY,
                this.info.PROP_KEYS_JSON,
                this.info.PROP_KEYS_NULL,
                this.info.PROP_KEYS_EMPTY,
                this.info.PROP_KEYS_ZERO,
                this.info.PROP_KEYS_STATIC
            ], false, false, false, utils.getList.bind(utils));
            arrayKeys = arrayKeys.map(e => {
                e = utils.getList(e, false);
                if (!e.length || e.length > 2) {
                    throw new SystemError(`该特性属性值格式: 两层getList表达式，使能分割为二维数组：[ [getList前导标识(可省略)，要转换的字段名称] ]，示例：field1, -:-field2`);
                }
                return e.length === 1 ? ["", e[0]] : e;
            });
            if (_alternativeFormData) {
                var formData = _alternativeFormData;
            } else {
                var formData = this.getFormParams(true);
                if (this.has.FLAG_STATIC) {
                    formData = utils.resolvePropertyList(formData, staticKeys);
                }
            }
            return this._tool_convertForm2JsonParams(formData, placeHolder, whiteKeys, invert,
                forceKeys, arrayKeys, jsonKeys, nullKeys, emptyKeys, zeroKeys);
        }

        converter_form_to_urlencoded(_alternativeFormData=null) {
            return this._converter_form_to_uricommon(this._property_urlencoded, _alternativeFormData);
        }

        converter_form_to_urldecoded(_alternativeFormData=null) {
            return this._converter_form_to_uricommon(this._property_urldecoded, _alternativeFormData);
        }

        converter_form_to_url(_alternativeFormData=null) {
            return this._converter_form_to_uricommon(this._property_no_uricoded, _alternativeFormData);
        }

        converter_json_to_form(_alternativeJsonData=null) {
            const jsonData = _alternativeJsonData || this.getJsonParams(false);
            const result = this._tool_convertJson2FormParams(jsonData);
            // return this.has.FLAG_STATIC
            //     // @bugs: 目前这种实现，对变量替换后可能存在的换行符没法正确处理
            //     ? utils.resolveScalar(result)
            //     : result;
            return result;
        }

        // tips: <true>, <false> 将分别转换为 "true", "false"；<null> 将转换为空
        _converter_json_to_uricommon(fn, _alternativeJsonData=null) {
            return Object.entries(_alternativeJsonData || this.getJsonParams(false))
            .reduce(function(result, [key, value], index) {
                if (typeof value === "object" && value !== null) {
                    throw new SystemError(`json转换为uriencoded/uridecoded/uri：只支持单层对象（即每个键的值为非object类型）：发现【${key} => ${utils.getType(value)}】`);
                }
                return result += ((index === 0 ? "" : "&") + fn.call(this, {
                    key: key,
                    value: value
                }));
            }.bind(this), "");
        }

        converter_json_to_urlencoded(_alternativeJsonData=null) {
            return this._converter_json_to_uricommon(this._property_urlencoded, _alternativeJsonData);
        }

        converter_json_to_urldecoded(_alternativeJsonData=null) {
            return this._converter_json_to_uricommon(this._property_urldecoded, _alternativeJsonData);
        }

        converter_json_to_url(_alternativeJsonData=null) {
            return this._converter_json_to_uricommon(this._property_no_uricoded, _alternativeJsonData);
        }

        converter_json_to_plain(_alternativeJsonData=null) {
            this.cfg.is_plain_text = true;
            const [jsonData, placeHolder] = _alternativeJsonData
                ? [_alternativeJsonData, null]
                : this.getJsonParams(true);
            const result = JSON.stringify(jsonData);
            return placeHolder
                ? result.replace(new RegExp(`"${placeHolder}|${placeHolder}"`, "g"), "")
                : result;
        }

        // tips: 默认假定文本为 urlencoded 格式
        // tips: 注意将不会对换行、空格字符等作处理，可以认为是bug，也可以认为不是。
        _converter_url_to_propertycommon(_alternativeTextData=null) {
            if (_alternativeTextData) {
                var textData = _alternativeTextData;
            } else {
                var textData = this.getTextParams();
                if (this.has.FLAG_STATIC) {
                    textData = utils.resolveScalar(textData);
                }
            }
            return textData.split("&").reduce((result, pair, index, src) => {
                let [key, ...parts] = pair.split("="), value = parts.join("");
                if (parts.length === 0) {
                    if (src.length === 1) {
                        throw new SystemError(`普通文本当前只支持对类 urlencoded格式(a=b&c=d) 和json格式的参数进行转换`);
                    }
                    const nearToLeft = index > 0 ? `${src[index - 1]}&` : "",
                        nearToRight = index < src.length - 1 ? `&${src[index + 1]}` : "";
                    throw new SystemError(`发现非键值对文本：在【${nearToLeft}${pair}${nearToRight}】附近`);
                }
                [key, value] = [key, value].map(e =>  decodeURIComponent(e));
                return result.push({key: key, value: value}), result;
            }, []);
        }

        converter_url_to_form(_alternativeTextData=null) {
            return this._converter_url_to_propertycommon(_alternativeTextData).reduce(function(result, property, index) {
                // return result += ((index === 0 ? "" : "\n") + `${property.key}:${property.value}`
                // // tips: 特殊换行符处理，注意不要放到公共函数去处理
                // .replace(/\r?\n/g, String.fromCodePoint(8629)));
                return result += ((index === 0 ? "" : "\n")
                    // tips: 特殊换行符处理，注意不要放到公共函数去处理
                    + this._protect_newline_char(`${property.key}:${property.value}`));
            }.bind(this), "");
        }

        // @bugs: 键名相同的字段，暂时不支持转换为json
        converter_url_to_json(_alternativeTextData=null) {
            return this.converter_form_to_json(this._converter_url_to_propertycommon(_alternativeTextData));
        }

        converter_url_to_urlencoded(_alternativeTextData=null) {
            return this.converter_form_to_urlencoded(this._converter_url_to_propertycommon(_alternativeTextData));
        }

        converter_url_to_urldecoded(_alternativeTextData=null) {
            return this.converter_form_to_urldecoded(this._converter_url_to_propertycommon(_alternativeTextData));
        }

        getFormParams(raiseForIllegal=false) {
            let formdata = parameters.isFormStyle ? parameters.formData : [];
            formdata = parameters.filterEnabled(formdata);
            if (raiseForIllegal) {
                formdata.reduce((defined, property) => {
                    // @bugs: 诸如 [0][name], [0][age] 暂不能正确转换为数组型json
                    const key = property.key.trim(),
                        pattern1 = /^[^\[\]]+(\[[^\[\]]*\])*$/,     // name, name[], name[1], name[age]
                        pattern2 = /^\[[^\[\]]*\]$/;                // [], [1], [name]
                    if (property.type === "file") {
                        return defined;
                    }
                    if (!key) {
                        throw new SystemError(`发现有字段键名为空`);
                    }
                    if (key.search(pattern1) === -1 &&
                        key.search(pattern2) === -1) {
                        throw new SystemError(`暂不支持该类格式字段的转换："${property.key}"`);
                    }
                    if (defined.has(key)) {
                        // duplicate key is enable for query, or body when key.endsWith("[]") is true
                        if (!key.endsWith("[]")) {
                            throw new SystemError(`暂不支持重名字段的转换（键名以[]结尾的除外）："${property.key}"`);
                        }
                    }
                    return defined.add(key), defined;
                }, new Set());
            }
            return formdata;
        }

        /**
         * @return:
         *      usePlaceHolder === true  => <Array[#jsonObj, #placeHolder]>
         *      usePlaceHolder === false => #jsonObj
         *  jsonObj 可能是 <null>
         */
        getJsonParams(usePlaceHolder=false) {
            let data = parameters.isJsonStyle && parameters.data || "{}";
            try {
                data = JSON.parse(data);
                if (typeof data !== "object") {
                    throw new SystemError("暂不支持对非object类型的json进行转换").withSignal("invalidJsonSig");
                }
                return usePlaceHolder ? [data, null] : data;
            } catch (e) {
                if (SystemError.hasSignal(e, "invalidJsonSig")) {
                    throw new SystemError(e);
                }
                try {
                    // tips: 注意结果可能包含placeholder，后续须将其替换
                    const patchedText = this._tool_patchJsonObjectValueUnQuoteVariables(data, usePlaceHolder);
                    const result = JSON.parse(usePlaceHolder ? patchedText[0] : patchedText);
                    return usePlaceHolder ? [result, patchedText[1]] : result;
                } catch (nil) {
                    throw new SystemError(e).withLabel("JSON解析失败");
                }
            }
        }

        getTextParams() {
            return parameters.isRawStyle ? parameters.data : "";
        }

        serializeParams() {
            if (parameters.isFormStyle) {
                const obj = parameters.formData.toObject();
                return JSON.stringify(obj);
            }
            return this.isRawStyle ? this.data : "";
        }

        redirectToConsole(result, format, fromFormat, _lastException) {
            const hint = !this.has.FLAG_NO_RECYCLE ? "（当前模式不支持循环转换）" : "",
                prefix = `【请求参数转换结果：${fromFormat}->${format}】${hint}`;
            console.log(prefix, result.startsWith("\n") ? result : "\n" + result);
            this.setExceptionLabel(null);
            throw new SystemError(_lastException).withMessage(`请求参数已转换，请从Console面板中查看和复制转换结果`);
        }

        determineNextFormat(cache, _specifyFormat=null) {
            if (_specifyFormat) {
                if (!this.C._recycle_rules.has(_specifyFormat)) {
                    throw new SystemError;
                }
                return [_specifyFormat, null];
            }
            const cached = cache.data, P = parameters, { lff, lf, lt, lr } = cached;
            if (this.has.FLAG_NO_RECYCLE
                || ([lff, lf, lt, lr].some(e => e == null))
                || (new Date().valueOf() - Number(lt) > 15 * 1000)
                || (P.rinfo.requestId !== lr)
                || (this.serializeParams() !== cached.lc)) {
                return [null, null];
            }
            const formatNames = this.C._recycle_rules.get(lff),
                seekNextFormat = (f) => {
                    let i = formatNames.indexOf(f);
                    return (i === -1 || i === formatNames.length - 1) ? formatNames[0] : formatNames[i + 1];
                },
                nextFormat = seekNextFormat(lf),
                candidateFormat = seekNextFormat(nextFormat);
            return [nextFormat, candidateFormat];
        }

        natureConvert(isSpecific) {
            let format = [], result, P = parameters, recentException = null;
            switch(true) {
                case P.isFormStyle:
                    // tips: 表单类型参数，源格式是确定的，如果是指定了转换格式，则免除一次默认转换
                    result = isSpecific ? null : this.converter_form_to_json();
                    format = isSpecific ? ["form", null] : ["form", "json"];
                    break;
                case P.isJsonStyle:
                    try {
                        result = this.converter_json_to_form();
                        format = ["json", "form"];
                        break;
                    } catch(e) {
                        // TODO
                        if (!(e instanceof SystemError)) {
                            throw new SystemError(e).withLabel("数据不正确或系统错误");
                        }
                        !recentException && (recentException = e);
                    }
                    // continue next block
                case P.isRawStyle && !P.isJsonStyle:
                    try {
                        result = this.converter_url_to_form();
                        format = ["url", "form"];
                        break;
                    } catch(e) {
                        // TODO
                        if (!(e instanceof SystemError)) {
                            throw new SystemError(e).withLabel("数据不正确或系统错误");
                        }
                        !recentException && (recentException = e);
                    }
                    // continue next block
                default:
                    throw new SystemError(recentException).withLabel("不支持转换的请求体类型或数据");
            }
            return [result, format];
        }

        /**
         * @return: <Array[#resultFormat, #resultContent]>
         */
        switchToNext(nextFormat, candidateFormat, isSpecific) {
            this.setExceptionLabel("转换失败");
            const [result, [fromFormat, toFormat]] = this.natureConvert(isSpecific);
            if (!nextFormat || toFormat === nextFormat) {
                return [result, toFormat, fromFormat];
            }
            if (fromFormat === nextFormat && candidateFormat) {
                nextFormat = candidateFormat;
            }
            const convertFunction = this[`converter_${fromFormat}_to_${nextFormat}`];
            if (typeof convertFunction !== "function") {
                throw new SystemError(`未定义的转换方法【converter_${fromFormat}_to_${nextFormat}】：暂不支持`);
            }
            return [convertFunction.call(this), nextFormat, fromFormat];
        }

        async start() {
            return this.resolve(async function(resolved) {
                const cache = this.cacheGet(), P = parameters,
                    specifiedFormat = resolved || null, isSpecific = Boolean(specifiedFormat),
                    [nextFormat, candidateFormat] = this.determineNextFormat(cache, specifiedFormat),
                    [result, format, fromFormat] = this.switchToNext(nextFormat, candidateFormat, isSpecific),
                    cacheData = {
                        lf: format,
                        lff: fromFormat,
                        lc: this.serializeParams(),
                        lt: new Date().valueOf(),
                        lr: P.rinfo.requestId,
                    };
                if (typeof result !== "string") {
                    throw new SystemError;
                }
                if (this.has.FLAG_NO_DETECT_SERVICE) {
                    // BUGS: 通过日志打印转换结果：将无法使用循环转换功能，因为 pm.variables.set() 系列方法只有在请求成功发送（pre-request脚本没报错）的情况下才会将变量值的变更真正持久化保存。
                    cache.update(cacheData);
                    return this.redirectToConsole(result, format, fromFormat);
                }

                await this.setService(true, true, result.trim())
                .catch(e => {
                    cache.update(cacheData);
                    return this.redirectToConsole(result, format, fromFormat, e);
                })
                .then(() => {
                    cache.update(cacheData);
                    return Promise.reject(new CancelSignal(`/${this.name}`));
                });
            });
        }
    });

    // handlers.add("flow", class extends handlers.base {

    // });

    // handlers.add("mock", class extends handlers.base {

    // });

    // handlers.add("sample", class extends handlers.base {

    // });

    handlers.add("signer", class extends handlers.base {
        static ARGS = handlers.base.ANY_ARG_REQUIRED;

        static PROPERTIES = {
            PROP_SERVICE: ["service.profile", "", "service"]
        };

        static _resolve_cfg = [_ResolveTypes.RESOLVE_SIGNER_NAME_TYPE, true, false];

        static _pre_get_inline = true;

        verify(result) {
            if (typeof result !== "string") {
                throw new SystemError(`计算结果不是字符串类型：【${utils.getType(result)}】`, result);
            }
            if (!result.trim()) {
                throw new SystemError(`计算结果为空：【${result}】`, result);
            }
            if (utils.hasToken(result)) {
                throw new SystemError(`计算结果不能包含postman变量引用：【${result}】`, result);
            }
            if (/\s/.test(result)) {
                log.warn(`签名计算结果包含空白字符`);
            }
        }

        async start() {
            return this.resolve(async function(resolved) {
                const signer = $$.signer.data[resolved];
                const scope = global;
                const arglist = [parameters.C.createFinalParamInterface()];
                this.setExceptionLabel(`签名计算错误(${resolved})`);
                log.info(`开始计算签名：签名函数：${resolved}`);
                let result = signer.apply(scope, arglist);
                if (!signer.isSync) {
                    result = await result;
                    if (result instanceof SendResult) {
                        result = result.data;
                    }
                }
                this.verify(result);
                log.info(`签名计算结果(${resolved})："${result}"`);
                utils.setVariable(this.option.arg, result);
                return true;
            });
        }
    });

    handlers.add("extra", class extends handlers.base {
        static _resolve_cfg = [_ResolveTypes.RESOLVE_EXTRA_TYPE, true, false];

        // remove Body's json comment
        params_rmbjc() {
            if (parameters.isJsonStyle) {
                log.warn(`请注意：请求体数据可能已由【/extra - rmbjc】功能参数开关修改`);
                parameters.updateBody($$.utils.removeJsonComments(parameters.data));
            } else {
                throw new SystemError(`移除请求体注释功能暂时只支持 RAW-JSON 格式`);
            }
        }

        start() {
            return this.resolve(function(resolved) {
                return resolved.map(function(one) {
                    const fn = `params_${one[1]}`;
                    if (!_.isFunction(this[fn])) {
                        throw new SystemError(`未定义的功能参数：【${one.join("")}】`);
                    }
                    return one;
                }, this)
                .forEach(function(one) {
                    const [flag, name] = one;
                    return flag === "+" && this[`params_${name}`]();
                }, this);
            });
        }
    });

    handlers.add("echo", class extends handlers.base {
        static FLAGS = {
            FLAG_OFFCIAL_API: ["o", ""]
        };

        static PROPERTIES = {
            PROP_SERVICE: ["service.profile", "", "service"],
            PROP_OUTCOME_TARGET: ["outcome.target", "", "target"],
            PROP_OUTCOME_FORMAT: ["outcome.format", "", "format"]
        };

        static _resolve_cfg = [_ResolveTypes.RESOLVE_ANY_TYPE, true, false];

        joinParams(url) {
            url = utils.toUrl(url);
            const params = utils.toUrl(pm.request.url.toString()).getQueryString();
            url.addQueryParams(params);
            return url.toString();
        }

        async start() {
            return this.resolve(async function(resolved) {
                await this.setService(true, true).then(sender => {
                    if (this.has.FLAG_OFFCIAL_API) {
                        var urlObj = utils.toUrl(`https://postman-echo.com/${parameters.method.toLowerCase()}`);
                    } else {
                        var urlObj = utils.toUrl(utils.joinUrlPath(sender.profile.server, sender.profile.echoPath));
                        const [target, format] = this.getManyInOne([
                            this.info.PROP_OUTCOME_TARGET,
                            this.info.PROP_OUTCOME_FORMAT], false, false, false);
                        ["origin_mode"].forEach(name => {
                            if (parameters.std_params.findIndex(e => e.key === name) !== -1) {
                                throw new SystemError(`GET参数："${name}" 是程序保留字段，请改用其他名称`);
                            }
                        });
                        const mode = parameters.isRawStyle ? "raw-" + parameters.lang : parameters.mode;
                        urlObj.addQueryParams(`origin_mode=${mode || ""}`);

                        if (target) {
                            ["outcome_target", "outcome_format"].forEach(name => {
                                if (parameters.std_params.findIndex(e => e.key === name) !== -1) {
                                    throw new SystemError(`GET参数："${name}" 是程序保留字段，请改用其他名称`);
                                }
                            });
                            urlObj.addQueryParams(`outcome_target=${target}`);
                            if (format) {
                                urlObj.addQueryParams(`outcome_format=${format || ""}`);
                            }
                        }
                    }
                    urlObj.addQueryParams(parameters.std_params);
                    return sender.replace({ url: urlObj.toString() });
                });
                throw new CancelSignal(`/${this.name}`);
            });
        }
    });

    await new Options().parseFromRequest()
    .then(() => interfaces.addInterface({
        name: "interface",
        get overrideAttrs() {
            return parameters.isTestScript
                ? [
                        ["jsonresp", pm.response.json],
                        ["jsonpresp", pm.response.jsonp],
                        ["textresp", pm.response.text]
                    ].reduce(function(obj, [attr, method]) {
                        return Object.defineProperty(obj, attr, {
                            configurable: true,
                            enumerable: true,
                            get() {
                                try { return method.call(pm.response); }
                                catch(e) { throw new SystemError(e).withLabel(`【${attr}】响应不是目标格式`); }
                            }
                        });
                    }, {
                        checkresp: interfaces.addInterface(["checkresp", {}, null,
                            function (target, attr) {
                                attr = attr.toLowerCase();
                                if (attr.startsWith("status")) {
                                    const code = attr.substring(6);
                                    if (/^[0-9]{3}$/.test(code)) {
                                        return target[attr] = target[attr] ||
                                        pm.test(`Status code is ${code}`, function () {
                                            pm.response.to.have.status(Number(code));
                                        });
                                    }
                                }
                                if (attr.startsWith("format")) {
                                    const format = attr.substring(6);
                                    if (/^json$/.test(format)) {
                                        return target[attr] = target[attr] ||
                                        pm.test(`Response data is ${format}`, function () {
                                            pm.response.to.be.json;
                                        });
                                    }
                                }
                                throw new SystemError("【checkresp】动态属性仅包括 statusXXX、formatXXX，示例：status200、formatjson");
                        }])
                    })
                : {};
        },
        get innerTarget() {
            return {
                log: log,                   sdk: sdk,
                libs: libs,                 utils: utils,
                config: config,             parameters: parameters,
                SystemError: SystemError,   SendResult: SendResult,
                Executor: Executor,         AsyncFunction: AsyncFunction,
                params: interfaces.params || parameters.C.createFinalParamInterface(),
                options: interfaces.addInterface(["options", {
                    has: function(name) {
                        this._parsed = this._parsed || utils.getVariable("__postman.script.parsedOptions__").split(",");
                        return this._parsed.includes(name);
                    }
                }]),
                extractor: interfaces.addInterface(["extractor", {
                    _extract: function(source, obj, namespace) {
                        const { dest, fn, match } = obj;
                        namespace || (namespace = {});
                        const result = fn.call(obj, source, namespace);
                        if (!_.isString(result)) {
                            throw new SystemError(`@fn: 未返回字符串类型，实际类型：${utils.getType(result)}`, result);
                        }
                        if (_.isString(match) && result.indexOf(match) === -1) {
                            throw new SystemError(`@match: 未通过子串测试，实际结果：${result}，测试：${match}`);
                        } else
                        if (_.isRegExp(match) && !match.test(result)) {
                            throw new SystemError(`@match: 未通过表达式测试，实际结果：${result}，测试：${match}`);
                        } else
                        if (_.isFunction(match) && match.call(obj, result, namespace) !== true) {
                            throw new SystemError(`@match: 未通过函数测试，实际结果：${result}，测试： ${match}`);
                        }
                        if (dest) {
                            utils.setVariable(dest, result);
                        }
                    },
                    extract: function(source, obj, namespace=null) {
                        try {
                            this._extract(source, obj, namespace);
                            return this;
                        } catch (e) {
                            throw new SystemError(e).withLabel(`内容提取 #${obj.name || ""}#`);
                        }
                    }
                }])
            };
        }
    }))
    .then(selfScript)
    .finally(() => {
        setTimeout(() => {
            clearTimeout(global._globalTimer);
        }, 0);
    });
})(...args)
.catch(error => {
    if (this._isCancelSignal) {
        setImmediate(() => {
            return this._globalTimer && clearTimeout(this._globalTimer);
        });
        return;
    }
    console.log(pm.request, `at 【${pm.info.eventName} script】`);
    error instanceof Error
        ? error.constructor._isSystemError
            ? error.printDetail()
            : console.error(error.stack)
        : console.error(error) || (error = new Error("系统错误"));
    this._globalTimer2 = setImmediate(() => {
        this._globalTimer && clearTimeout(this._globalTimer);
        /** 使用 newman 运行时，newman 无法识别异步函数中抛出的错误（throw语句，这可能是 newman 的一个BUG），
         *      从而导致即便此脚本报错了，请求仍继续发送，这与在 postman UI中运行时的行为不一致，也不是所期望的行为
         *  实际测试可以通过 pm.text()（不是 pm.expect()）来强制抛出错误
         *  为判断当前脚本是在 newman 中运行，需要在导出集合后手动增加一个集合作用域变量：
         *      "variables": [
         *          {
		 *	            "key": "__postman.script.engine__",
		 *	            "value": "newman",  // 对应 init value
		 *	            "type": "string"
		 *          }
         *      ]
         */
        if (pm.info.eventName === "prerequest") {
            const engine = pm.collectionVariables.get("__postman.script.engine__");
            const isNewman = engine && engine.toLowerCase() === "newman";
            if (isNewman) {
                pm.test('pre-request script execute failed', function(done) {
                    // 如果在 newman 中指定了 --bail 选项，则立即抛出错误，不会发送集合中的任何请求
                    // 如果未指定 --bail 选项，则集合中的第一个请求仍会发送出去，但会因断言失败而被判定为请求失败
                    // tips: --bail failure 和 --bail 意义相同
                    postman.setNextRequest(null);
                    pm.expect(error).to.be.true;
                });
            }
        }
        // 必要，否则某些情况下的错误会卡请求
        this._globalTimer2 && clearImmediate(this._globalTimer2);

        throw error;
    });
}));