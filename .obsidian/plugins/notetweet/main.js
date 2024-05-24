'use strict';

var obsidian = require('obsidian');
var fs = require('fs');
var EventEmitter = require('events');
var https = require('https');
var zlib = require('zlib');
var require$$0$2 = require('crypto');
var url_1 = require('url');
var util_1 = require('util');
var require$$0$4 = require('stream');
var http = require('http');
var require$$0$3 = require('dns');
var os = require('os');
var require$$0$5 = require('buffer');
var http2 = require('http2');
var tls = require('tls');
var net = require('net');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

function _interopNamespace(e) {
    if (e && e.__esModule) return e;
    var n = Object.create(null);
    if (e) {
        Object.keys(e).forEach(function (k) {
            if (k !== 'default') {
                var d = Object.getOwnPropertyDescriptor(e, k);
                Object.defineProperty(n, k, d.get ? d : {
                    enumerable: true,
                    get: function () { return e[k]; }
                });
            }
        });
    }
    n["default"] = e;
    return Object.freeze(n);
}

var fs__namespace = /*#__PURE__*/_interopNamespace(fs);
var fs__default = /*#__PURE__*/_interopDefaultLegacy(fs);
var EventEmitter__default = /*#__PURE__*/_interopDefaultLegacy(EventEmitter);
var https__default = /*#__PURE__*/_interopDefaultLegacy(https);
var zlib__namespace = /*#__PURE__*/_interopNamespace(zlib);
var zlib__default = /*#__PURE__*/_interopDefaultLegacy(zlib);
var require$$0__namespace = /*#__PURE__*/_interopNamespace(require$$0$2);
var require$$0__default = /*#__PURE__*/_interopDefaultLegacy(require$$0$2);
var url_1__default = /*#__PURE__*/_interopDefaultLegacy(url_1);
var util_1__default = /*#__PURE__*/_interopDefaultLegacy(util_1);
var require$$0__default$2 = /*#__PURE__*/_interopDefaultLegacy(require$$0$4);
var http__default = /*#__PURE__*/_interopDefaultLegacy(http);
var require$$0__default$1 = /*#__PURE__*/_interopDefaultLegacy(require$$0$3);
var os__default = /*#__PURE__*/_interopDefaultLegacy(os);
var require$$0__default$3 = /*#__PURE__*/_interopDefaultLegacy(require$$0$5);
var http2__default = /*#__PURE__*/_interopDefaultLegacy(http2);
var tls__default = /*#__PURE__*/_interopDefaultLegacy(tls);
var net__default = /*#__PURE__*/_interopDefaultLegacy(net);

const API_V2_PREFIX = 'https://api.twitter.com/2/';
const API_V2_LABS_PREFIX = 'https://api.twitter.com/labs/2/';
const API_V1_1_PREFIX = 'https://api.twitter.com/1.1/';
const API_V1_1_UPLOAD_PREFIX = 'https://upload.twitter.com/1.1/';
const API_V1_1_STREAM_PREFIX = 'https://stream.twitter.com/1.1/';

/** TwitterPaginator: able to get consume data from initial request, then fetch next data sequentially. */
class TwitterPaginator {
    // noinspection TypeScriptAbstractClassConstructorCanBeMadeProtected
    constructor({ realData, rateLimit, instance, queryParams, sharedParams }) {
        this._maxResultsWhenFetchLast = 100;
        this._realData = realData;
        this._rateLimit = rateLimit;
        this._instance = instance;
        this._queryParams = queryParams;
        this._sharedParams = sharedParams;
    }
    get _isRateLimitOk() {
        if (!this._rateLimit) {
            return true;
        }
        const resetDate = this._rateLimit.reset * 1000;
        if (resetDate < Date.now()) {
            return true;
        }
        return this._rateLimit.remaining > 0;
    }
    makeRequest(queryParams) {
        return this._instance.get(this.getEndpoint(), queryParams, { fullResponse: true, params: this._sharedParams });
    }
    makeNewInstanceFromResult(result, queryParams) {
        // Construct a subclass
        return new this.constructor({
            realData: result.data,
            rateLimit: result.rateLimit,
            instance: this._instance,
            queryParams,
            sharedParams: this._sharedParams,
        });
    }
    getEndpoint() {
        return this._endpoint;
    }
    injectQueryParams(maxResults) {
        return {
            ...(maxResults ? { max_results: maxResults } : {}),
            ...this._queryParams,
        };
    }
    /* ---------------------- */
    /* Real paginator methods */
    /* ---------------------- */
    /**
     * Next page.
     */
    async next(maxResults) {
        const queryParams = this.getNextQueryParams(maxResults);
        const result = await this.makeRequest(queryParams);
        return this.makeNewInstanceFromResult(result, queryParams);
    }
    /**
     * Next page, but store it in current instance.
     */
    async fetchNext(maxResults) {
        const queryParams = this.getNextQueryParams(maxResults);
        const result = await this.makeRequest(queryParams);
        // Await in case of async sub-methods
        await this.refreshInstanceFromResult(result, true);
        return this;
    }
    /**
     * Fetch up to {count} items after current page,
     * as long as rate limit is not hit and Twitter has some results
     */
    async fetchLast(count = Infinity) {
        let queryParams = this.getNextQueryParams(this._maxResultsWhenFetchLast);
        let resultCount = 0;
        // Break at rate limit limit
        while (resultCount < count && this._isRateLimitOk) {
            const response = await this.makeRequest(queryParams);
            await this.refreshInstanceFromResult(response, true);
            resultCount += this.getPageLengthFromRequest(response);
            if (this.isFetchLastOver(response)) {
                break;
            }
            queryParams = this.getNextQueryParams(this._maxResultsWhenFetchLast);
        }
        return this;
    }
    get rateLimit() {
        var _a;
        return { ...(_a = this._rateLimit) !== null && _a !== void 0 ? _a : {} };
    }
    /** Get raw data returned by Twitter API. */
    get data() {
        return this._realData;
    }
    get done() {
        return !this.canFetchNextPage(this._realData);
    }
    /**
     * Iterate over currently fetched items.
     */
    *[Symbol.iterator]() {
        yield* this.getItemArray();
    }
    /**
     * Iterate over items "indefinitely" (until rate limit is hit / they're no more items available)
     * This will **mutate the current instance** and fill data, metas, etc. inside this instance.
     *
     * If you need to handle concurrent requests, or you need to rely on immutability, please use `.fetchAndIterate()` instead.
     */
    async *[Symbol.asyncIterator]() {
        yield* this.getItemArray();
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let paginator = this;
        let canFetchNextPage = this.canFetchNextPage(this._realData);
        while (canFetchNextPage && this._isRateLimitOk && paginator.getItemArray().length > 0) {
            const next = await paginator.next(this._maxResultsWhenFetchLast);
            // Store data into current instance [needed to access includes and meta]
            this.refreshInstanceFromResult({ data: next._realData, headers: {}, rateLimit: next._rateLimit }, true);
            canFetchNextPage = this.canFetchNextPage(next._realData);
            const items = next.getItemArray();
            yield* items;
            paginator = next;
        }
    }
    /**
     * Iterate over items "indefinitely" without modifying the current instance (until rate limit is hit / they're no more items available)
     *
     * This will **NOT** mutate the current instance, meaning that current instance will not inherit from `includes` and `meta` (v2 API only).
     * Use `Symbol.asyncIterator` (`for-await of`) to directly access items with current instance mutation.
     */
    async *fetchAndIterate() {
        for (const item of this.getItemArray()) {
            yield [item, this];
        }
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let paginator = this;
        let canFetchNextPage = this.canFetchNextPage(this._realData);
        while (canFetchNextPage && this._isRateLimitOk && paginator.getItemArray().length > 0) {
            const next = await paginator.next(this._maxResultsWhenFetchLast);
            // Store data into current instance [needed to access includes and meta]
            this.refreshInstanceFromResult({ data: next._realData, headers: {}, rateLimit: next._rateLimit }, true);
            canFetchNextPage = this.canFetchNextPage(next._realData);
            for (const item of next.getItemArray()) {
                yield [item, next];
            }
            this._rateLimit = next._rateLimit;
            paginator = next;
        }
    }
}
/** PreviousableTwitterPaginator: a TwitterPaginator able to get consume data from both side, next and previous. */
class PreviousableTwitterPaginator extends TwitterPaginator {
    /**
     * Previous page (new tweets)
     */
    async previous(maxResults) {
        const queryParams = this.getPreviousQueryParams(maxResults);
        const result = await this.makeRequest(queryParams);
        return this.makeNewInstanceFromResult(result, queryParams);
    }
    /**
     * Previous page, but in current instance.
     */
    async fetchPrevious(maxResults) {
        const queryParams = this.getPreviousQueryParams(maxResults);
        const result = await this.makeRequest(queryParams);
        await this.refreshInstanceFromResult(result, false);
        return this;
    }
}

class CursoredV1Paginator extends TwitterPaginator {
    getNextQueryParams(maxResults) {
        var _a;
        return {
            ...this._queryParams,
            cursor: (_a = this._realData.next_cursor_str) !== null && _a !== void 0 ? _a : this._realData.next_cursor,
            ...(maxResults ? { count: maxResults } : {}),
        };
    }
    isFetchLastOver(result) {
        // If we cant fetch next page
        return !this.canFetchNextPage(result.data);
    }
    canFetchNextPage(result) {
        // If one of cursor is valid
        return !this.isNextCursorInvalid(result.next_cursor) || !this.isNextCursorInvalid(result.next_cursor_str);
    }
    isNextCursorInvalid(value) {
        return value === undefined
            || value === 0
            || value === -1
            || value === '0'
            || value === '-1';
    }
}

class DmEventsV1Paginator extends CursoredV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'direct_messages/events/list.json';
    }
    refreshInstanceFromResult(response, isNextPage) {
        const result = response.data;
        this._rateLimit = response.rateLimit;
        if (isNextPage) {
            this._realData.events.push(...result.events);
            this._realData.next_cursor = result.next_cursor;
        }
    }
    getPageLengthFromRequest(result) {
        return result.data.events.length;
    }
    getItemArray() {
        return this.events;
    }
    /**
     * Events returned by paginator.
     */
    get events() {
        return this._realData.events;
    }
}
class WelcomeDmV1Paginator extends CursoredV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'direct_messages/welcome_messages/list.json';
    }
    refreshInstanceFromResult(response, isNextPage) {
        const result = response.data;
        this._rateLimit = response.rateLimit;
        if (isNextPage) {
            this._realData.welcome_messages.push(...result.welcome_messages);
            this._realData.next_cursor = result.next_cursor;
        }
    }
    getPageLengthFromRequest(result) {
        return result.data.welcome_messages.length;
    }
    getItemArray() {
        return this.welcomeMessages;
    }
    get welcomeMessages() {
        return this._realData.welcome_messages;
    }
}

var EUploadMimeType;
(function (EUploadMimeType) {
    EUploadMimeType["Jpeg"] = "image/jpeg";
    EUploadMimeType["Mp4"] = "video/mp4";
    EUploadMimeType["Mov"] = "video/quicktime";
    EUploadMimeType["Gif"] = "image/gif";
    EUploadMimeType["Png"] = "image/png";
    EUploadMimeType["Srt"] = "text/plain";
    EUploadMimeType["Webp"] = "image/webp";
})(EUploadMimeType || (EUploadMimeType = {}));

// Creation of DMs
var EDirectMessageEventTypeV1;
(function (EDirectMessageEventTypeV1) {
    EDirectMessageEventTypeV1["Create"] = "message_create";
    EDirectMessageEventTypeV1["WelcomeCreate"] = "welcome_message";
})(EDirectMessageEventTypeV1 || (EDirectMessageEventTypeV1 = {}));

var ETwitterApiError;
(function (ETwitterApiError) {
    ETwitterApiError["Request"] = "request";
    ETwitterApiError["PartialResponse"] = "partial-response";
    ETwitterApiError["Response"] = "response";
})(ETwitterApiError || (ETwitterApiError = {}));
/* ERRORS INSTANCES */
class ApiError extends Error {
    constructor() {
        super(...arguments);
        this.error = true;
    }
}
class ApiRequestError extends ApiError {
    constructor(message, options) {
        super(message);
        this.type = ETwitterApiError.Request;
        Error.captureStackTrace(this, this.constructor);
        // Do not show on Node stack trace
        Object.defineProperty(this, '_options', { value: options });
    }
    get request() {
        return this._options.request;
    }
    get requestError() {
        return this._options.requestError;
    }
    toJSON() {
        return {
            type: this.type,
            error: this.requestError,
        };
    }
}
class ApiPartialResponseError extends ApiError {
    constructor(message, options) {
        super(message);
        this.type = ETwitterApiError.PartialResponse;
        Error.captureStackTrace(this, this.constructor);
        // Do not show on Node stack trace
        Object.defineProperty(this, '_options', { value: options });
    }
    get request() {
        return this._options.request;
    }
    get response() {
        return this._options.response;
    }
    get responseError() {
        return this._options.responseError;
    }
    get rawContent() {
        return this._options.rawContent;
    }
    toJSON() {
        return {
            type: this.type,
            error: this.responseError,
        };
    }
}
class ApiResponseError extends ApiError {
    constructor(message, options) {
        super(message);
        this.type = ETwitterApiError.Response;
        Error.captureStackTrace(this, this.constructor);
        // Do not show on Node stack trace
        Object.defineProperty(this, '_options', { value: options });
        this.code = options.code;
        this.headers = options.headers;
        this.rateLimit = options.rateLimit;
        // Fix bad error data payload on some v1 endpoints (see https://github.com/PLhery/node-twitter-api-v2/issues/342)
        if (options.data && typeof options.data === 'object' && 'error' in options.data && !options.data.errors) {
            const data = { ...options.data };
            data.errors = [{
                    code: EApiV1ErrorCode.InternalError,
                    message: data.error,
                }];
            this.data = data;
        }
        else {
            this.data = options.data;
        }
    }
    get request() {
        return this._options.request;
    }
    get response() {
        return this._options.response;
    }
    /** Check for presence of one of given v1/v2 error codes. */
    hasErrorCode(...codes) {
        const errors = this.errors;
        // No errors
        if (!(errors === null || errors === void 0 ? void 0 : errors.length)) {
            return false;
        }
        // v1 errors
        if ('code' in errors[0]) {
            const v1errors = errors;
            return v1errors.some(error => codes.includes(error.code));
        }
        // v2 error
        const v2error = this.data;
        return codes.includes(v2error.type);
    }
    get errors() {
        var _a;
        return (_a = this.data) === null || _a === void 0 ? void 0 : _a.errors;
    }
    get rateLimitError() {
        return this.code === 420 || this.code === 429;
    }
    get isAuthError() {
        if (this.code === 401) {
            return true;
        }
        return this.hasErrorCode(EApiV1ErrorCode.AuthTimestampInvalid, EApiV1ErrorCode.AuthenticationFail, EApiV1ErrorCode.BadAuthenticationData, EApiV1ErrorCode.InvalidOrExpiredToken);
    }
    toJSON() {
        return {
            type: this.type,
            code: this.code,
            error: this.data,
            rateLimit: this.rateLimit,
            headers: this.headers,
        };
    }
}
var EApiV1ErrorCode;
(function (EApiV1ErrorCode) {
    // Location errors
    EApiV1ErrorCode[EApiV1ErrorCode["InvalidCoordinates"] = 3] = "InvalidCoordinates";
    EApiV1ErrorCode[EApiV1ErrorCode["NoLocationFound"] = 13] = "NoLocationFound";
    // Authentication failures
    EApiV1ErrorCode[EApiV1ErrorCode["AuthenticationFail"] = 32] = "AuthenticationFail";
    EApiV1ErrorCode[EApiV1ErrorCode["InvalidOrExpiredToken"] = 89] = "InvalidOrExpiredToken";
    EApiV1ErrorCode[EApiV1ErrorCode["UnableToVerifyCredentials"] = 99] = "UnableToVerifyCredentials";
    EApiV1ErrorCode[EApiV1ErrorCode["AuthTimestampInvalid"] = 135] = "AuthTimestampInvalid";
    EApiV1ErrorCode[EApiV1ErrorCode["BadAuthenticationData"] = 215] = "BadAuthenticationData";
    // Resources not found or visible
    EApiV1ErrorCode[EApiV1ErrorCode["NoUserMatch"] = 17] = "NoUserMatch";
    EApiV1ErrorCode[EApiV1ErrorCode["UserNotFound"] = 50] = "UserNotFound";
    EApiV1ErrorCode[EApiV1ErrorCode["ResourceNotFound"] = 34] = "ResourceNotFound";
    EApiV1ErrorCode[EApiV1ErrorCode["TweetNotFound"] = 144] = "TweetNotFound";
    EApiV1ErrorCode[EApiV1ErrorCode["TweetNotVisible"] = 179] = "TweetNotVisible";
    EApiV1ErrorCode[EApiV1ErrorCode["NotAllowedResource"] = 220] = "NotAllowedResource";
    EApiV1ErrorCode[EApiV1ErrorCode["MediaIdNotFound"] = 325] = "MediaIdNotFound";
    EApiV1ErrorCode[EApiV1ErrorCode["TweetNoLongerAvailable"] = 421] = "TweetNoLongerAvailable";
    EApiV1ErrorCode[EApiV1ErrorCode["TweetViolatedRules"] = 422] = "TweetViolatedRules";
    // Account errors
    EApiV1ErrorCode[EApiV1ErrorCode["TargetUserSuspended"] = 63] = "TargetUserSuspended";
    EApiV1ErrorCode[EApiV1ErrorCode["YouAreSuspended"] = 64] = "YouAreSuspended";
    EApiV1ErrorCode[EApiV1ErrorCode["AccountUpdateFailed"] = 120] = "AccountUpdateFailed";
    EApiV1ErrorCode[EApiV1ErrorCode["NoSelfSpamReport"] = 36] = "NoSelfSpamReport";
    EApiV1ErrorCode[EApiV1ErrorCode["NoSelfMute"] = 271] = "NoSelfMute";
    EApiV1ErrorCode[EApiV1ErrorCode["AccountLocked"] = 326] = "AccountLocked";
    // Application live errors / Twitter errors
    EApiV1ErrorCode[EApiV1ErrorCode["RateLimitExceeded"] = 88] = "RateLimitExceeded";
    EApiV1ErrorCode[EApiV1ErrorCode["NoDMRightForApp"] = 93] = "NoDMRightForApp";
    EApiV1ErrorCode[EApiV1ErrorCode["OverCapacity"] = 130] = "OverCapacity";
    EApiV1ErrorCode[EApiV1ErrorCode["InternalError"] = 131] = "InternalError";
    EApiV1ErrorCode[EApiV1ErrorCode["TooManyFollowings"] = 161] = "TooManyFollowings";
    EApiV1ErrorCode[EApiV1ErrorCode["TweetLimitExceeded"] = 185] = "TweetLimitExceeded";
    EApiV1ErrorCode[EApiV1ErrorCode["DuplicatedTweet"] = 187] = "DuplicatedTweet";
    EApiV1ErrorCode[EApiV1ErrorCode["TooManySpamReports"] = 205] = "TooManySpamReports";
    EApiV1ErrorCode[EApiV1ErrorCode["RequestLooksLikeSpam"] = 226] = "RequestLooksLikeSpam";
    EApiV1ErrorCode[EApiV1ErrorCode["NoWriteRightForApp"] = 261] = "NoWriteRightForApp";
    EApiV1ErrorCode[EApiV1ErrorCode["TweetActionsDisabled"] = 425] = "TweetActionsDisabled";
    EApiV1ErrorCode[EApiV1ErrorCode["TweetRepliesRestricted"] = 433] = "TweetRepliesRestricted";
    // Invalid request parameters
    EApiV1ErrorCode[EApiV1ErrorCode["NamedParameterMissing"] = 38] = "NamedParameterMissing";
    EApiV1ErrorCode[EApiV1ErrorCode["InvalidAttachmentUrl"] = 44] = "InvalidAttachmentUrl";
    EApiV1ErrorCode[EApiV1ErrorCode["TweetTextTooLong"] = 186] = "TweetTextTooLong";
    EApiV1ErrorCode[EApiV1ErrorCode["MissingUrlParameter"] = 195] = "MissingUrlParameter";
    EApiV1ErrorCode[EApiV1ErrorCode["NoMultipleGifs"] = 323] = "NoMultipleGifs";
    EApiV1ErrorCode[EApiV1ErrorCode["InvalidMediaIds"] = 324] = "InvalidMediaIds";
    EApiV1ErrorCode[EApiV1ErrorCode["InvalidUrl"] = 407] = "InvalidUrl";
    EApiV1ErrorCode[EApiV1ErrorCode["TooManyTweetAttachments"] = 386] = "TooManyTweetAttachments";
    // Already sent/deleted item
    EApiV1ErrorCode[EApiV1ErrorCode["StatusAlreadyFavorited"] = 139] = "StatusAlreadyFavorited";
    EApiV1ErrorCode[EApiV1ErrorCode["FollowRequestAlreadySent"] = 160] = "FollowRequestAlreadySent";
    EApiV1ErrorCode[EApiV1ErrorCode["CannotUnmuteANonMutedAccount"] = 272] = "CannotUnmuteANonMutedAccount";
    EApiV1ErrorCode[EApiV1ErrorCode["TweetAlreadyRetweeted"] = 327] = "TweetAlreadyRetweeted";
    EApiV1ErrorCode[EApiV1ErrorCode["ReplyToDeletedTweet"] = 385] = "ReplyToDeletedTweet";
    // DM Errors
    EApiV1ErrorCode[EApiV1ErrorCode["DMReceiverNotFollowingYou"] = 150] = "DMReceiverNotFollowingYou";
    EApiV1ErrorCode[EApiV1ErrorCode["UnableToSendDM"] = 151] = "UnableToSendDM";
    EApiV1ErrorCode[EApiV1ErrorCode["MustAllowDMFromAnyone"] = 214] = "MustAllowDMFromAnyone";
    EApiV1ErrorCode[EApiV1ErrorCode["CannotSendDMToThisUser"] = 349] = "CannotSendDMToThisUser";
    EApiV1ErrorCode[EApiV1ErrorCode["DMTextTooLong"] = 354] = "DMTextTooLong";
    // Application misconfiguration
    EApiV1ErrorCode[EApiV1ErrorCode["SubscriptionAlreadyExists"] = 355] = "SubscriptionAlreadyExists";
    EApiV1ErrorCode[EApiV1ErrorCode["CallbackUrlNotApproved"] = 415] = "CallbackUrlNotApproved";
    EApiV1ErrorCode[EApiV1ErrorCode["SuspendedApplication"] = 416] = "SuspendedApplication";
    EApiV1ErrorCode[EApiV1ErrorCode["OobOauthIsNotAllowed"] = 417] = "OobOauthIsNotAllowed";
})(EApiV1ErrorCode || (EApiV1ErrorCode = {}));
var EApiV2ErrorCode;
(function (EApiV2ErrorCode) {
    // Request errors
    EApiV2ErrorCode["InvalidRequest"] = "https://api.twitter.com/2/problems/invalid-request";
    EApiV2ErrorCode["ClientForbidden"] = "https://api.twitter.com/2/problems/client-forbidden";
    EApiV2ErrorCode["UnsupportedAuthentication"] = "https://api.twitter.com/2/problems/unsupported-authentication";
    // Stream rules errors
    EApiV2ErrorCode["InvalidRules"] = "https://api.twitter.com/2/problems/invalid-rules";
    EApiV2ErrorCode["TooManyRules"] = "https://api.twitter.com/2/problems/rule-cap";
    EApiV2ErrorCode["DuplicatedRules"] = "https://api.twitter.com/2/problems/duplicate-rules";
    // Twitter errors
    EApiV2ErrorCode["RateLimitExceeded"] = "https://api.twitter.com/2/problems/usage-capped";
    EApiV2ErrorCode["ConnectionError"] = "https://api.twitter.com/2/problems/streaming-connection";
    EApiV2ErrorCode["ClientDisconnected"] = "https://api.twitter.com/2/problems/client-disconnected";
    EApiV2ErrorCode["TwitterDisconnectedYou"] = "https://api.twitter.com/2/problems/operational-disconnect";
    // Resource errors
    EApiV2ErrorCode["ResourceNotFound"] = "https://api.twitter.com/2/problems/resource-not-found";
    EApiV2ErrorCode["ResourceUnauthorized"] = "https://api.twitter.com/2/problems/not-authorized-for-resource";
    EApiV2ErrorCode["DisallowedResource"] = "https://api.twitter.com/2/problems/disallowed-resource";
})(EApiV2ErrorCode || (EApiV2ErrorCode = {}));

var ETwitterStreamEvent;
(function (ETwitterStreamEvent) {
    ETwitterStreamEvent["Connected"] = "connected";
    ETwitterStreamEvent["ConnectError"] = "connect error";
    ETwitterStreamEvent["ConnectionError"] = "connection error";
    ETwitterStreamEvent["ConnectionClosed"] = "connection closed";
    ETwitterStreamEvent["ConnectionLost"] = "connection lost";
    ETwitterStreamEvent["ReconnectAttempt"] = "reconnect attempt";
    ETwitterStreamEvent["Reconnected"] = "reconnected";
    ETwitterStreamEvent["ReconnectError"] = "reconnect error";
    ETwitterStreamEvent["ReconnectLimitExceeded"] = "reconnect limit exceeded";
    ETwitterStreamEvent["DataKeepAlive"] = "data keep-alive";
    ETwitterStreamEvent["Data"] = "data event content";
    ETwitterStreamEvent["DataError"] = "data twitter error";
    ETwitterStreamEvent["TweetParseError"] = "data tweet parse error";
    ETwitterStreamEvent["Error"] = "stream error";
})(ETwitterStreamEvent || (ETwitterStreamEvent = {}));

class TwitterApiPluginResponseOverride {
    constructor(value) {
        this.value = value;
    }
}

const TwitterApiV2Settings = {
    debug: false,
    deprecationWarnings: true,
    logger: { log: console.log.bind(console) },
};

function sharedPromise(getter) {
    const sharedPromise = {
        value: undefined,
        promise: getter().then(val => {
            sharedPromise.value = val;
            return val;
        }),
    };
    return sharedPromise;
}
function arrayWrap(value) {
    if (Array.isArray(value)) {
        return value;
    }
    return [value];
}
function trimUndefinedProperties(object) {
    // Delete undefined parameters
    for (const parameter in object) {
        if (object[parameter] === undefined)
            delete object[parameter];
    }
}
function isTweetStreamV2ErrorPayload(payload) {
    // Is error only if 'errors' is present and 'data' does not exists
    return typeof payload === 'object'
        && 'errors' in payload
        && !('data' in payload);
}
function hasMultipleItems(item) {
    if (Array.isArray(item) && item.length > 1) {
        return true;
    }
    return item.toString().includes(',');
}
const deprecationWarningsCache = new Set();
function safeDeprecationWarning(message) {
    if (typeof console === 'undefined' || !console.warn || !TwitterApiV2Settings.deprecationWarnings) {
        return;
    }
    const hash = `${message.instance}-${message.method}-${message.problem}`;
    if (deprecationWarningsCache.has(hash)) {
        return;
    }
    const formattedMsg = `[twitter-api-v2] Deprecation warning: In ${message.instance}.${message.method}() call` +
        `, ${message.problem}.\n${message.resolution}.`;
    console.warn(formattedMsg);
    console.warn('To disable this message, import variable TwitterApiV2Settings from twitter-api-v2 and set TwitterApiV2Settings.deprecationWarnings to false.');
    deprecationWarningsCache.add(hash);
}

class RequestHandlerHelper {
    constructor(requestData) {
        this.requestData = requestData;
        this.requestErrorHandled = false;
        this.responseData = [];
    }
    /* Request helpers */
    get hrefPathname() {
        const url = this.requestData.url;
        return url.hostname + url.pathname;
    }
    isCompressionDisabled() {
        return !this.requestData.compression || this.requestData.compression === 'identity';
    }
    isFormEncodedEndpoint() {
        return this.requestData.url.href.startsWith('https://api.twitter.com/oauth/');
    }
    /* Error helpers */
    createRequestError(error) {
        return new ApiRequestError('Request failed.', {
            request: this.req,
            error,
        });
    }
    createPartialResponseError(error, abortClose) {
        const res = this.res;
        let message = `Request failed with partial response with HTTP code ${res.statusCode}`;
        if (abortClose) {
            message += ' (connection abruptly closed)';
        }
        else {
            message += ' (parse error)';
        }
        return new ApiPartialResponseError(message, {
            request: this.req,
            response: this.res,
            responseError: error,
            rawContent: Buffer.concat(this.responseData).toString(),
        });
    }
    formatV1Errors(errors) {
        return errors
            .map(({ code, message }) => `${message} (Twitter code ${code})`)
            .join(', ');
    }
    formatV2Error(error) {
        return `${error.title}: ${error.detail} (see ${error.type})`;
    }
    createResponseError({ res, data, rateLimit, code }) {
        var _a;
        // Errors formatting.
        let errorString = `Request failed with code ${code}`;
        if ((_a = data === null || data === void 0 ? void 0 : data.errors) === null || _a === void 0 ? void 0 : _a.length) {
            const errors = data.errors;
            if ('code' in errors[0]) {
                errorString += ' - ' + this.formatV1Errors(errors);
            }
            else {
                errorString += ' - ' + this.formatV2Error(data);
            }
        }
        return new ApiResponseError(errorString, {
            code,
            data,
            headers: res.headers,
            request: this.req,
            response: res,
            rateLimit,
        });
    }
    /* Response helpers */
    getResponseDataStream(res) {
        if (this.isCompressionDisabled()) {
            return res;
        }
        const contentEncoding = (res.headers['content-encoding'] || 'identity').trim().toLowerCase();
        if (contentEncoding === 'br') {
            const brotli = zlib__namespace.createBrotliDecompress({
                flush: zlib__namespace.constants.BROTLI_OPERATION_FLUSH,
                finishFlush: zlib__namespace.constants.BROTLI_OPERATION_FLUSH,
            });
            res.pipe(brotli);
            return brotli;
        }
        if (contentEncoding === 'gzip') {
            const gunzip = zlib__namespace.createGunzip({
                flush: zlib__namespace.constants.Z_SYNC_FLUSH,
                finishFlush: zlib__namespace.constants.Z_SYNC_FLUSH,
            });
            res.pipe(gunzip);
            return gunzip;
        }
        if (contentEncoding === 'deflate') {
            const inflate = zlib__namespace.createInflate({
                flush: zlib__namespace.constants.Z_SYNC_FLUSH,
                finishFlush: zlib__namespace.constants.Z_SYNC_FLUSH,
            });
            res.pipe(inflate);
            return inflate;
        }
        return res;
    }
    detectResponseType(res) {
        var _a, _b;
        // Auto parse if server responds with JSON body
        if (((_a = res.headers['content-type']) === null || _a === void 0 ? void 0 : _a.includes('application/json')) || ((_b = res.headers['content-type']) === null || _b === void 0 ? void 0 : _b.includes('application/problem+json'))) {
            return 'json';
        }
        // f-e oauth token endpoints
        else if (this.isFormEncodedEndpoint()) {
            return 'url';
        }
        return 'text';
    }
    getParsedResponse(res) {
        const data = this.responseData;
        const mode = this.requestData.forceParseMode || this.detectResponseType(res);
        if (mode === 'buffer') {
            return Buffer.concat(data);
        }
        else if (mode === 'text') {
            return Buffer.concat(data).toString();
        }
        else if (mode === 'json') {
            const asText = Buffer.concat(data).toString();
            return asText.length ? JSON.parse(asText) : undefined;
        }
        else if (mode === 'url') {
            const asText = Buffer.concat(data).toString();
            const formEntries = {};
            for (const [item, value] of new URLSearchParams(asText)) {
                formEntries[item] = value;
            }
            return formEntries;
        }
        else {
            // mode === 'none'
            return undefined;
        }
    }
    getRateLimitFromResponse(res) {
        let rateLimit = undefined;
        if (res.headers['x-rate-limit-limit']) {
            rateLimit = {
                limit: Number(res.headers['x-rate-limit-limit']),
                remaining: Number(res.headers['x-rate-limit-remaining']),
                reset: Number(res.headers['x-rate-limit-reset']),
            };
            if (res.headers['x-app-limit-24hour-limit']) {
                rateLimit.day = {
                    limit: Number(res.headers['x-app-limit-24hour-limit']),
                    remaining: Number(res.headers['x-app-limit-24hour-remaining']),
                    reset: Number(res.headers['x-app-limit-24hour-reset']),
                };
            }
            if (this.requestData.rateLimitSaver) {
                this.requestData.rateLimitSaver(rateLimit);
            }
        }
        return rateLimit;
    }
    /* Request event handlers */
    onSocketEventHandler(reject, cleanupListener, socket) {
        const onClose = this.onSocketCloseHandler.bind(this, reject);
        socket.on('close', onClose);
        cleanupListener.on('complete', () => socket.off('close', onClose));
    }
    onSocketCloseHandler(reject) {
        this.req.removeAllListeners('timeout');
        const res = this.res;
        if (res) {
            // Response ok, res.close/res.end can handle request ending
            return;
        }
        if (!this.requestErrorHandled) {
            return reject(this.createRequestError(new Error('Socket closed without any information.')));
        }
        // else: other situation
    }
    requestErrorHandler(reject, requestError) {
        var _a, _b;
        (_b = (_a = this.requestData).requestEventDebugHandler) === null || _b === void 0 ? void 0 : _b.call(_a, 'request-error', { requestError });
        this.requestErrorHandled = true;
        reject(this.createRequestError(requestError));
    }
    timeoutErrorHandler() {
        this.requestErrorHandled = true;
        this.req.destroy(new Error('Request timeout.'));
    }
    /* Response event handlers */
    classicResponseHandler(resolve, reject, res) {
        this.res = res;
        const dataStream = this.getResponseDataStream(res);
        // Register the response data
        dataStream.on('data', chunk => this.responseData.push(chunk));
        dataStream.on('end', this.onResponseEndHandler.bind(this, resolve, reject));
        dataStream.on('close', this.onResponseCloseHandler.bind(this, resolve, reject));
        // Debug handlers
        if (this.requestData.requestEventDebugHandler) {
            this.requestData.requestEventDebugHandler('response', { res });
            res.on('aborted', error => this.requestData.requestEventDebugHandler('response-aborted', { error }));
            res.on('error', error => this.requestData.requestEventDebugHandler('response-error', { error }));
            res.on('close', () => this.requestData.requestEventDebugHandler('response-close', { data: this.responseData }));
            res.on('end', () => this.requestData.requestEventDebugHandler('response-end'));
        }
    }
    onResponseEndHandler(resolve, reject) {
        const rateLimit = this.getRateLimitFromResponse(this.res);
        let data;
        try {
            data = this.getParsedResponse(this.res);
        }
        catch (e) {
            reject(this.createPartialResponseError(e, false));
            return;
        }
        // Handle bad error codes
        const code = this.res.statusCode;
        if (code >= 400) {
            reject(this.createResponseError({ data, res: this.res, rateLimit, code }));
            return;
        }
        resolve({
            data,
            headers: this.res.headers,
            rateLimit,
        });
    }
    onResponseCloseHandler(resolve, reject) {
        const res = this.res;
        if (res.aborted) {
            // Try to parse the request (?)
            try {
                this.getParsedResponse(this.res);
                // Ok, try to resolve normally the request
                return this.onResponseEndHandler(resolve, reject);
            }
            catch (e) {
                // Parse error, just drop with content
                return reject(this.createPartialResponseError(e, true));
            }
        }
        if (!res.complete) {
            return reject(this.createPartialResponseError(new Error('Response has been interrupted before response could be parsed.'), true));
        }
        // else: end has been called
    }
    streamResponseHandler(resolve, reject, res) {
        const code = res.statusCode;
        if (code < 400) {
            const dataStream = this.getResponseDataStream(res);
            // HTTP code ok, consume stream
            resolve({ req: this.req, res: dataStream, originalResponse: res, requestData: this.requestData });
        }
        else {
            // Handle response normally, can only rejects
            this.classicResponseHandler(() => undefined, reject, res);
        }
    }
    /* Wrappers for request lifecycle */
    debugRequest() {
        const url = this.requestData.url;
        TwitterApiV2Settings.logger.log(`[${this.requestData.options.method} ${this.hrefPathname}]`, this.requestData.options);
        if (url.search) {
            TwitterApiV2Settings.logger.log('Request parameters:', [...url.searchParams.entries()].map(([key, value]) => `${key}: ${value}`));
        }
        if (this.requestData.body) {
            TwitterApiV2Settings.logger.log('Request body:', this.requestData.body);
        }
    }
    buildRequest() {
        var _a;
        const url = this.requestData.url;
        const auth = url.username ? `${url.username}:${url.password}` : undefined;
        const headers = (_a = this.requestData.options.headers) !== null && _a !== void 0 ? _a : {};
        if (this.requestData.compression === true || this.requestData.compression === 'brotli') {
            headers['accept-encoding'] = 'br;q=1.0, gzip;q=0.8, deflate;q=0.5, *;q=0.1';
        }
        else if (this.requestData.compression === 'gzip') {
            headers['accept-encoding'] = 'gzip;q=1, deflate;q=0.5, *;q=0.1';
        }
        else if (this.requestData.compression === 'deflate') {
            headers['accept-encoding'] = 'deflate;q=1, *;q=0.1';
        }
        this.req = https.request({
            ...this.requestData.options,
            // Define URL params manually, addresses dependencies error https://github.com/PLhery/node-twitter-api-v2/issues/94
            host: url.hostname,
            port: url.port || undefined,
            path: url.pathname + url.search,
            protocol: url.protocol,
            auth,
            headers,
        });
    }
    registerRequestEventDebugHandlers(req) {
        req.on('close', () => this.requestData.requestEventDebugHandler('close'));
        req.on('abort', () => this.requestData.requestEventDebugHandler('abort'));
        req.on('socket', socket => {
            this.requestData.requestEventDebugHandler('socket', { socket });
            socket.on('error', error => this.requestData.requestEventDebugHandler('socket-error', { socket, error }));
            socket.on('connect', () => this.requestData.requestEventDebugHandler('socket-connect', { socket }));
            socket.on('close', withError => this.requestData.requestEventDebugHandler('socket-close', { socket, withError }));
            socket.on('end', () => this.requestData.requestEventDebugHandler('socket-end', { socket }));
            socket.on('lookup', (...data) => this.requestData.requestEventDebugHandler('socket-lookup', { socket, data }));
            socket.on('timeout', () => this.requestData.requestEventDebugHandler('socket-timeout', { socket }));
        });
    }
    makeRequest() {
        this.buildRequest();
        return new Promise((_resolve, _reject) => {
            // Hooks to call when promise is fulfulled to cleanup the socket (shared between requests)
            const resolve = value => {
                cleanupListener.emit('complete');
                _resolve(value);
            };
            const reject = value => {
                cleanupListener.emit('complete');
                _reject(value);
            };
            const cleanupListener = new EventEmitter.EventEmitter();
            const req = this.req;
            // Handle request errors
            req.on('error', this.requestErrorHandler.bind(this, reject));
            req.on('socket', this.onSocketEventHandler.bind(this, reject, cleanupListener));
            req.on('response', this.classicResponseHandler.bind(this, resolve, reject));
            if (this.requestData.options.timeout) {
                req.on('timeout', this.timeoutErrorHandler.bind(this));
            }
            // Debug handlers
            if (this.requestData.requestEventDebugHandler) {
                this.registerRequestEventDebugHandlers(req);
            }
            if (this.requestData.body) {
                req.write(this.requestData.body);
            }
            req.end();
        });
    }
    async makeRequestAsStream() {
        const { req, res, requestData, originalResponse } = await this.makeRequestAndResolveWhenReady();
        return new TweetStream(requestData, { req, res, originalResponse });
    }
    makeRequestAndResolveWhenReady() {
        this.buildRequest();
        return new Promise((resolve, reject) => {
            const req = this.req;
            // Handle request errors
            req.on('error', this.requestErrorHandler.bind(this, reject));
            req.on('response', this.streamResponseHandler.bind(this, resolve, reject));
            if (this.requestData.body) {
                req.write(this.requestData.body);
            }
            req.end();
        });
    }
}

class TweetStreamEventCombiner extends EventEmitter.EventEmitter {
    constructor(stream) {
        super();
        this.stream = stream;
        this.stack = [];
        this.onStreamData = this.onStreamData.bind(this);
        this.onStreamError = this.onStreamError.bind(this);
        this.onceNewEvent = this.once.bind(this, 'event');
        // Init events from stream
        stream.on(ETwitterStreamEvent.Data, this.onStreamData);
        // Ignore reconnect errors: Don't close event combiner until connection error/closed
        stream.on(ETwitterStreamEvent.ConnectionError, this.onStreamError);
        stream.on(ETwitterStreamEvent.TweetParseError, this.onStreamError);
        stream.on(ETwitterStreamEvent.ConnectionClosed, this.onStreamError);
    }
    /** Returns a new `Promise` that will `resolve` on next event (`data` or any sort of error). */
    nextEvent() {
        return new Promise(this.onceNewEvent);
    }
    /** Returns `true` if there's something in the stack. */
    hasStack() {
        return this.stack.length > 0;
    }
    /** Returns stacked data events, and clean the stack. */
    popStack() {
        const stack = this.stack;
        this.stack = [];
        return stack;
    }
    /** Cleanup all the listeners attached on stream. */
    destroy() {
        this.removeAllListeners();
        this.stream.off(ETwitterStreamEvent.Data, this.onStreamData);
        this.stream.off(ETwitterStreamEvent.ConnectionError, this.onStreamError);
        this.stream.off(ETwitterStreamEvent.TweetParseError, this.onStreamError);
        this.stream.off(ETwitterStreamEvent.ConnectionClosed, this.onStreamError);
    }
    emitEvent(type, payload) {
        this.emit('event', { type, payload });
    }
    onStreamError(payload) {
        this.emitEvent('error', payload);
    }
    onStreamData(payload) {
        this.stack.push(payload);
        this.emitEvent('data', payload);
    }
}

class TweetStreamParser extends EventEmitter.EventEmitter {
    constructor() {
        super(...arguments);
        this.currentMessage = '';
    }
    // Code partially belongs to twitter-stream-api for this
    // https://github.com/trygve-lie/twitter-stream-api/blob/master/lib/parser.js
    push(chunk) {
        this.currentMessage += chunk;
        chunk = this.currentMessage;
        const size = chunk.length;
        let start = 0;
        let offset = 0;
        while (offset < size) {
            // Take [offset, offset+1] inside a new string
            if (chunk.slice(offset, offset + 2) === '\r\n') {
                // If chunk contains \r\n after current offset,
                // parse [start, ..., offset] as a tweet
                const piece = chunk.slice(start, offset);
                start = offset += 2;
                // If empty object
                if (!piece.length) {
                    continue;
                }
                try {
                    const payload = JSON.parse(piece);
                    if (payload) {
                        this.emit(EStreamParserEvent.ParsedData, payload);
                        continue;
                    }
                }
                catch (error) {
                    this.emit(EStreamParserEvent.ParseError, error);
                }
            }
            offset++;
        }
        this.currentMessage = chunk.slice(start, size);
    }
    /** Reset the currently stored message (f.e. on connection reset) */
    reset() {
        this.currentMessage = '';
    }
}
var EStreamParserEvent;
(function (EStreamParserEvent) {
    EStreamParserEvent["ParsedData"] = "parsed data";
    EStreamParserEvent["ParseError"] = "parse error";
})(EStreamParserEvent || (EStreamParserEvent = {}));

// In seconds
const basicRetriesAttempt = [5, 15, 30, 60, 90, 120, 180, 300, 600, 900];
// Default retry function
const basicReconnectRetry = tryOccurrence => tryOccurrence > basicRetriesAttempt.length
    ? 901000
    : basicRetriesAttempt[tryOccurrence - 1] * 1000;
class TweetStream extends EventEmitter.EventEmitter {
    constructor(requestData, connection) {
        super();
        this.requestData = requestData;
        this.autoReconnect = false;
        this.autoReconnectRetries = 5;
        // 2 minutes without any Twitter signal
        this.keepAliveTimeoutMs = 1000 * 120;
        this.nextRetryTimeout = basicReconnectRetry;
        this.parser = new TweetStreamParser();
        this.connectionProcessRunning = false;
        this.onKeepAliveTimeout = this.onKeepAliveTimeout.bind(this);
        this.initEventsFromParser();
        if (connection) {
            this.req = connection.req;
            this.res = connection.res;
            this.originalResponse = connection.originalResponse;
            this.initEventsFromRequest();
        }
    }
    on(event, handler) {
        return super.on(event, handler);
    }
    initEventsFromRequest() {
        if (!this.req || !this.res) {
            throw new Error('TweetStream error: You cannot init TweetStream without a request and response object.');
        }
        const errorHandler = (err) => {
            this.emit(ETwitterStreamEvent.ConnectionError, err);
            this.emit(ETwitterStreamEvent.Error, {
                type: ETwitterStreamEvent.ConnectionError,
                error: err,
                message: 'Connection lost or closed by Twitter.',
            });
            this.onConnectionError();
        };
        this.req.on('error', errorHandler);
        this.res.on('error', errorHandler);
        // Usually, connection should not be closed by Twitter!
        this.res.on('close', () => errorHandler(new Error('Connection closed by Twitter.')));
        this.res.on('data', (chunk) => {
            this.resetKeepAliveTimeout();
            if (chunk.toString() === '\r\n') {
                return this.emit(ETwitterStreamEvent.DataKeepAlive);
            }
            this.parser.push(chunk.toString());
        });
        // Starts the keep alive timeout
        this.resetKeepAliveTimeout();
    }
    initEventsFromParser() {
        const payloadIsError = this.requestData.payloadIsError;
        this.parser.on(EStreamParserEvent.ParsedData, (eventData) => {
            if (payloadIsError && payloadIsError(eventData)) {
                this.emit(ETwitterStreamEvent.DataError, eventData);
                this.emit(ETwitterStreamEvent.Error, {
                    type: ETwitterStreamEvent.DataError,
                    error: eventData,
                    message: 'Twitter sent a payload that is detected as an error payload.',
                });
            }
            else {
                this.emit(ETwitterStreamEvent.Data, eventData);
            }
        });
        this.parser.on(EStreamParserEvent.ParseError, (error) => {
            this.emit(ETwitterStreamEvent.TweetParseError, error);
            this.emit(ETwitterStreamEvent.Error, {
                type: ETwitterStreamEvent.TweetParseError,
                error,
                message: 'Failed to parse stream data.',
            });
        });
    }
    resetKeepAliveTimeout() {
        this.unbindKeepAliveTimeout();
        if (this.keepAliveTimeoutMs !== Infinity) {
            this.keepAliveTimeout = setTimeout(this.onKeepAliveTimeout, this.keepAliveTimeoutMs);
        }
    }
    onKeepAliveTimeout() {
        this.emit(ETwitterStreamEvent.ConnectionLost);
        this.onConnectionError();
    }
    unbindTimeouts() {
        this.unbindRetryTimeout();
        this.unbindKeepAliveTimeout();
    }
    unbindKeepAliveTimeout() {
        if (this.keepAliveTimeout) {
            clearTimeout(this.keepAliveTimeout);
            this.keepAliveTimeout = undefined;
        }
    }
    unbindRetryTimeout() {
        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = undefined;
        }
    }
    closeWithoutEmit() {
        this.unbindTimeouts();
        if (this.res) {
            this.res.removeAllListeners();
            // Close response silently
            this.res.destroy();
        }
        if (this.req) {
            this.req.removeAllListeners();
            // Close connection silently
            this.req.destroy();
        }
    }
    /** Terminate connection to Twitter. */
    close() {
        this.emit(ETwitterStreamEvent.ConnectionClosed);
        this.closeWithoutEmit();
    }
    /** Unbind all listeners, and close connection. */
    destroy() {
        this.removeAllListeners();
        this.close();
    }
    /**
     * Make a new request that creates a new `TweetStream` instance with
     * the same parameters, and bind current listeners to new stream.
     */
    async clone() {
        const newRequest = new RequestHandlerHelper(this.requestData);
        const newStream = await newRequest.makeRequestAsStream();
        // Clone attached listeners
        const listenerNames = this.eventNames();
        for (const listener of listenerNames) {
            const callbacks = this.listeners(listener);
            for (const callback of callbacks) {
                newStream.on(listener, callback);
            }
        }
        return newStream;
    }
    /** Start initial stream connection, setup options on current instance and returns itself. */
    async connect(options = {}) {
        if (typeof options.autoReconnect !== 'undefined') {
            this.autoReconnect = options.autoReconnect;
        }
        if (typeof options.autoReconnectRetries !== 'undefined') {
            this.autoReconnectRetries = options.autoReconnectRetries === 'unlimited'
                ? Infinity
                : options.autoReconnectRetries;
        }
        if (typeof options.keepAliveTimeout !== 'undefined') {
            this.keepAliveTimeoutMs = options.keepAliveTimeout === 'disable'
                ? Infinity
                : options.keepAliveTimeout;
        }
        if (typeof options.nextRetryTimeout !== 'undefined') {
            this.nextRetryTimeout = options.nextRetryTimeout;
        }
        // Make the connection
        this.unbindTimeouts();
        try {
            await this.reconnect();
        }
        catch (e) {
            this.emit(ETwitterStreamEvent.ConnectError, 0);
            this.emit(ETwitterStreamEvent.Error, {
                type: ETwitterStreamEvent.ConnectError,
                error: e,
                message: 'Connect error - Initial connection just failed.',
            });
            // Only make a reconnection attempt if autoReconnect is true!
            // Otherwise, let error be propagated
            if (this.autoReconnect) {
                this.makeAutoReconnectRetry(0, e);
            }
            else {
                throw e;
            }
        }
        return this;
    }
    /** Make a new request to (re)connect to Twitter. */
    async reconnect() {
        if (this.connectionProcessRunning) {
            throw new Error('Connection process is already running.');
        }
        this.connectionProcessRunning = true;
        try {
            let initialConnection = true;
            if (this.req) {
                initialConnection = false;
                this.closeWithoutEmit();
            }
            const { req, res, originalResponse } = await new RequestHandlerHelper(this.requestData).makeRequestAndResolveWhenReady();
            this.req = req;
            this.res = res;
            this.originalResponse = originalResponse;
            this.emit(initialConnection ? ETwitterStreamEvent.Connected : ETwitterStreamEvent.Reconnected);
            this.parser.reset();
            this.initEventsFromRequest();
        }
        finally {
            this.connectionProcessRunning = false;
        }
    }
    async onConnectionError(retryOccurrence = 0) {
        this.unbindTimeouts();
        // Close the request if necessary
        this.closeWithoutEmit();
        // Terminate stream by events if necessary (no auto-reconnect or retries exceeded)
        if (!this.autoReconnect) {
            this.emit(ETwitterStreamEvent.ConnectionClosed);
            return;
        }
        if (retryOccurrence >= this.autoReconnectRetries) {
            this.emit(ETwitterStreamEvent.ReconnectLimitExceeded);
            this.emit(ETwitterStreamEvent.ConnectionClosed);
            return;
        }
        // If all other conditions fails, do a reconnect attempt
        try {
            this.emit(ETwitterStreamEvent.ReconnectAttempt, retryOccurrence);
            await this.reconnect();
        }
        catch (e) {
            this.emit(ETwitterStreamEvent.ReconnectError, retryOccurrence);
            this.emit(ETwitterStreamEvent.Error, {
                type: ETwitterStreamEvent.ReconnectError,
                error: e,
                message: `Reconnect error - ${retryOccurrence + 1} attempts made yet.`,
            });
            this.makeAutoReconnectRetry(retryOccurrence, e);
        }
    }
    makeAutoReconnectRetry(retryOccurrence, error) {
        const nextRetry = this.nextRetryTimeout(retryOccurrence + 1, error);
        this.retryTimeout = setTimeout(() => {
            this.onConnectionError(retryOccurrence + 1);
        }, nextRetry);
    }
    async *[Symbol.asyncIterator]() {
        const eventCombiner = new TweetStreamEventCombiner(this);
        try {
            while (true) {
                if (!this.req || this.req.aborted) {
                    throw new Error('Connection closed');
                }
                if (eventCombiner.hasStack()) {
                    yield* eventCombiner.popStack();
                }
                const { type, payload } = await eventCombiner.nextEvent();
                if (type === 'error') {
                    throw payload;
                }
            }
        }
        finally {
            eventCombiner.destroy();
        }
    }
}

/* Plugin helpers */
function hasRequestErrorPlugins(client) {
    var _a;
    if (!((_a = client.clientSettings.plugins) === null || _a === void 0 ? void 0 : _a.length)) {
        return false;
    }
    for (const plugin of client.clientSettings.plugins) {
        if (plugin.onRequestError || plugin.onResponseError) {
            return true;
        }
    }
    return false;
}
async function applyResponseHooks(requestParams, computedParams, requestOptions, error) {
    let override;
    if (error instanceof ApiRequestError || error instanceof ApiPartialResponseError) {
        override = await this.applyPluginMethod('onRequestError', {
            client: this,
            url: this.getUrlObjectFromUrlString(requestParams.url),
            params: requestParams,
            computedParams,
            requestOptions,
            error,
        });
    }
    else if (error instanceof ApiResponseError) {
        override = await this.applyPluginMethod('onResponseError', {
            client: this,
            url: this.getUrlObjectFromUrlString(requestParams.url),
            params: requestParams,
            computedParams,
            requestOptions,
            error,
        });
    }
    if (override && override instanceof TwitterApiPluginResponseOverride) {
        return override.value;
    }
    return Promise.reject(error);
}

class OAuth1Helper {
    constructor(options) {
        this.nonceLength = 32;
        this.consumerKeys = options.consumerKeys;
    }
    static percentEncode(str) {
        return encodeURIComponent(str)
            .replace(/!/g, '%21')
            .replace(/\*/g, '%2A')
            .replace(/'/g, '%27')
            .replace(/\(/g, '%28')
            .replace(/\)/g, '%29');
    }
    hash(base, key) {
        return require$$0__namespace
            .createHmac('sha1', key)
            .update(base)
            .digest('base64');
    }
    authorize(request, accessTokens = {}) {
        const oauthInfo = {
            oauth_consumer_key: this.consumerKeys.key,
            oauth_nonce: this.getNonce(),
            oauth_signature_method: 'HMAC-SHA1',
            oauth_timestamp: this.getTimestamp(),
            oauth_version: '1.0',
        };
        if (accessTokens.key !== undefined) {
            oauthInfo.oauth_token = accessTokens.key;
        }
        if (!request.data) {
            request.data = {};
        }
        oauthInfo.oauth_signature = this.getSignature(request, accessTokens.secret, oauthInfo);
        return oauthInfo;
    }
    toHeader(oauthInfo) {
        const sorted = sortObject(oauthInfo);
        let header_value = 'OAuth ';
        for (const element of sorted) {
            if (element.key.indexOf('oauth_') !== 0) {
                continue;
            }
            header_value += OAuth1Helper.percentEncode(element.key) + '="' + OAuth1Helper.percentEncode(element.value) + '",';
        }
        return {
            // Remove the last ,
            Authorization: header_value.slice(0, header_value.length - 1),
        };
    }
    getNonce() {
        const wordCharacters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < this.nonceLength; i++) {
            result += wordCharacters[Math.trunc(Math.random() * wordCharacters.length)];
        }
        return result;
    }
    getTimestamp() {
        return Math.trunc(new Date().getTime() / 1000);
    }
    getSignature(request, tokenSecret, oauthInfo) {
        return this.hash(this.getBaseString(request, oauthInfo), this.getSigningKey(tokenSecret));
    }
    getSigningKey(tokenSecret) {
        return OAuth1Helper.percentEncode(this.consumerKeys.secret) + '&' + OAuth1Helper.percentEncode(tokenSecret || '');
    }
    getBaseString(request, oauthInfo) {
        return request.method.toUpperCase() + '&'
            + OAuth1Helper.percentEncode(this.getBaseUrl(request.url)) + '&'
            + OAuth1Helper.percentEncode(this.getParameterString(request, oauthInfo));
    }
    getParameterString(request, oauthInfo) {
        const baseStringData = sortObject(percentEncodeData(mergeObject(oauthInfo, mergeObject(request.data, deParamUrl(request.url)))));
        let dataStr = '';
        for (const { key, value } of baseStringData) {
            // check if the value is an array
            // this means that this key has multiple values
            if (value && Array.isArray(value)) {
                // sort the array first
                value.sort();
                let valString = '';
                // serialize all values for this key: e.g. formkey=formvalue1&formkey=formvalue2
                value.forEach((item, i) => {
                    valString += key + '=' + item;
                    if (i < value.length) {
                        valString += '&';
                    }
                });
                dataStr += valString;
            }
            else {
                dataStr += key + '=' + value + '&';
            }
        }
        // Remove the last character
        return dataStr.slice(0, dataStr.length - 1);
    }
    getBaseUrl(url) {
        return url.split('?')[0];
    }
}
// Helper functions //
function mergeObject(obj1, obj2) {
    return {
        ...obj1 || {},
        ...obj2 || {},
    };
}
function sortObject(data) {
    return Object.keys(data)
        .sort()
        .map(key => ({ key, value: data[key] }));
}
function deParam(string) {
    const split = string.split('&');
    const data = {};
    for (const coupleKeyValue of split) {
        const [key, value = ''] = coupleKeyValue.split('=');
        // check if the key already exists
        // this can occur if the QS part of the url contains duplicate keys like this: ?formkey=formvalue1&formkey=formvalue2
        if (data[key]) {
            // the key exists already
            if (!Array.isArray(data[key])) {
                // replace the value with an array containing the already present value
                data[key] = [data[key]];
            }
            // and add the new found value to it
            data[key].push(decodeURIComponent(value));
        }
        else {
            // it doesn't exist, just put the found value in the data object
            data[key] = decodeURIComponent(value);
        }
    }
    return data;
}
function deParamUrl(url) {
    const tmp = url.split('?');
    if (tmp.length === 1)
        return {};
    return deParam(tmp[1]);
}
function percentEncodeData(data) {
    const result = {};
    for (const key in data) {
        let value = data[key];
        // check if the value is an array
        if (value && Array.isArray(value)) {
            value = value.map(v => OAuth1Helper.percentEncode(v));
        }
        else {
            value = OAuth1Helper.percentEncode(value);
        }
        result[OAuth1Helper.percentEncode(key)] = value;
    }
    return result;
}

// This class is partially inspired by https://github.com/form-data/form-data/blob/master/lib/form_data.js
// All credits to their authors.
class FormDataHelper {
    constructor() {
        this._boundary = '';
        this._chunks = [];
    }
    bodyAppend(...values) {
        const allAsBuffer = values.map(val => val instanceof Buffer ? val : Buffer.from(val));
        this._chunks.push(...allAsBuffer);
    }
    append(field, value, contentType) {
        const convertedValue = value instanceof Buffer ? value : value.toString();
        const header = this.getMultipartHeader(field, convertedValue, contentType);
        this.bodyAppend(header, convertedValue, FormDataHelper.LINE_BREAK);
    }
    getHeaders() {
        return {
            'content-type': 'multipart/form-data; boundary=' + this.getBoundary(),
        };
    }
    /** Length of form-data (including footer length). */
    getLength() {
        return this._chunks.reduce((acc, cur) => acc + cur.length, this.getMultipartFooter().length);
    }
    getBuffer() {
        const allChunks = [...this._chunks, this.getMultipartFooter()];
        const totalBuffer = Buffer.alloc(this.getLength());
        let i = 0;
        for (const chunk of allChunks) {
            for (let j = 0; j < chunk.length; i++, j++) {
                totalBuffer[i] = chunk[j];
            }
        }
        return totalBuffer;
    }
    getBoundary() {
        if (!this._boundary) {
            this.generateBoundary();
        }
        return this._boundary;
    }
    generateBoundary() {
        // This generates a 50 character boundary similar to those used by Firefox.
        let boundary = '--------------------------';
        for (let i = 0; i < 24; i++) {
            boundary += Math.floor(Math.random() * 10).toString(16);
        }
        this._boundary = boundary;
    }
    getMultipartHeader(field, value, contentType) {
        // In this lib no need to guess more the content type, octet stream is ok of buffers
        if (!contentType) {
            contentType = value instanceof Buffer ? FormDataHelper.DEFAULT_CONTENT_TYPE : '';
        }
        const headers = {
            'Content-Disposition': ['form-data', `name="${field}"`],
            'Content-Type': contentType,
        };
        let contents = '';
        for (const [prop, header] of Object.entries(headers)) {
            // skip nullish headers.
            if (!header.length) {
                continue;
            }
            contents += prop + ': ' + arrayWrap(header).join('; ') + FormDataHelper.LINE_BREAK;
        }
        return '--' + this.getBoundary() + FormDataHelper.LINE_BREAK + contents + FormDataHelper.LINE_BREAK;
    }
    getMultipartFooter() {
        if (this._footerChunk) {
            return this._footerChunk;
        }
        return this._footerChunk = Buffer.from('--' + this.getBoundary() + '--' + FormDataHelper.LINE_BREAK);
    }
}
FormDataHelper.LINE_BREAK = '\r\n';
FormDataHelper.DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/* Helpers functions that are specific to this class but do not depends on instance */
class RequestParamHelpers {
    static formatQueryToString(query) {
        const formattedQuery = {};
        for (const prop in query) {
            if (typeof query[prop] === 'string') {
                formattedQuery[prop] = query[prop];
            }
            else if (typeof query[prop] !== 'undefined') {
                formattedQuery[prop] = String(query[prop]);
            }
        }
        return formattedQuery;
    }
    static autoDetectBodyType(url) {
        if (url.pathname.startsWith('/2/') || url.pathname.startsWith('/labs/2/')) {
            // oauth2 takes url encoded
            if (url.password.startsWith('/2/oauth2')) {
                return 'url';
            }
            // Twitter API v2 has JSON-encoded requests for everything else
            return 'json';
        }
        if (url.hostname === 'upload.twitter.com') {
            if (url.pathname === '/1.1/media/upload.json') {
                return 'form-data';
            }
            // json except for media/upload command, that is form-data.
            return 'json';
        }
        const endpoint = url.pathname.split('/1.1/', 2)[1];
        if (this.JSON_1_1_ENDPOINTS.has(endpoint)) {
            return 'json';
        }
        return 'url';
    }
    static addQueryParamsToUrl(url, query) {
        const queryEntries = Object.entries(query);
        if (queryEntries.length) {
            let search = '';
            for (const [key, value] of queryEntries) {
                search += (search.length ? '&' : '?') + `${OAuth1Helper.percentEncode(key)}=${OAuth1Helper.percentEncode(value)}`;
            }
            url.search = search;
        }
    }
    static constructBodyParams(body, headers, mode) {
        if (body instanceof Buffer) {
            return body;
        }
        if (mode === 'json') {
            if (!headers['content-type']) {
                headers['content-type'] = 'application/json;charset=UTF-8';
            }
            return JSON.stringify(body);
        }
        else if (mode === 'url') {
            if (!headers['content-type']) {
                headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
            }
            if (Object.keys(body).length) {
                return new URLSearchParams(body)
                    .toString()
                    .replace(/\*/g, '%2A'); // URLSearchParams doesnt encode '*', but Twitter wants it encoded.
            }
            return '';
        }
        else if (mode === 'raw') {
            throw new Error('You can only use raw body mode with Buffers. To give a string, use Buffer.from(str).');
        }
        else {
            const form = new FormDataHelper();
            for (const parameter in body) {
                form.append(parameter, body[parameter]);
            }
            if (!headers['content-type']) {
                const formHeaders = form.getHeaders();
                headers['content-type'] = formHeaders['content-type'];
            }
            return form.getBuffer();
        }
    }
    static setBodyLengthHeader(options, body) {
        var _a;
        options.headers = (_a = options.headers) !== null && _a !== void 0 ? _a : {};
        if (typeof body === 'string') {
            options.headers['content-length'] = Buffer.byteLength(body);
        }
        else {
            options.headers['content-length'] = body.length;
        }
    }
    static isOAuthSerializable(item) {
        return !(item instanceof Buffer);
    }
    static mergeQueryAndBodyForOAuth(query, body) {
        const parameters = {};
        for (const prop in query) {
            parameters[prop] = query[prop];
        }
        if (this.isOAuthSerializable(body)) {
            for (const prop in body) {
                const bodyProp = body[prop];
                if (this.isOAuthSerializable(bodyProp)) {
                    parameters[prop] = typeof bodyProp === 'object' && bodyProp !== null && 'toString' in bodyProp
                        ? bodyProp.toString()
                        : bodyProp;
                }
            }
        }
        return parameters;
    }
    static moveUrlQueryParamsIntoObject(url, query) {
        for (const [param, value] of url.searchParams) {
            query[param] = value;
        }
        // Remove the query string
        url.search = '';
        return url;
    }
    /**
     * Replace URL parameters available in pathname, like `:id`, with data given in `parameters`:
     * `https://twitter.com/:id.json` + `{ id: '20' }` => `https://twitter.com/20.json`
     */
    static applyRequestParametersToUrl(url, parameters) {
        url.pathname = url.pathname.replace(/:([A-Z_-]+)/ig, (fullMatch, paramName) => {
            if (parameters[paramName] !== undefined) {
                return String(parameters[paramName]);
            }
            return fullMatch;
        });
        return url;
    }
}
RequestParamHelpers.JSON_1_1_ENDPOINTS = new Set([
    'direct_messages/events/new.json',
    'direct_messages/welcome_messages/new.json',
    'direct_messages/welcome_messages/rules/new.json',
    'media/metadata/create.json',
    'collections/entries/curate.json',
]);

class OAuth2Helper {
    static getCodeVerifier() {
        return this.generateRandomString(128);
    }
    static getCodeChallengeFromVerifier(verifier) {
        return this.escapeBase64Url(require$$0__namespace
            .createHash('sha256')
            .update(verifier)
            .digest('base64'));
    }
    static getAuthHeader(clientId, clientSecret) {
        const key = encodeURIComponent(clientId) + ':' + encodeURIComponent(clientSecret);
        return Buffer.from(key).toString('base64');
    }
    static generateRandomString(length) {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        for (let i = 0; i < length; i++) {
            text += possible[Math.floor(Math.random() * possible.length)];
        }
        return text;
    }
    static escapeBase64Url(string) {
        return string.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    }
}

class ClientRequestMaker {
    constructor(settings) {
        this.rateLimits = {};
        this.clientSettings = {};
        if (settings) {
            this.clientSettings = settings;
        }
    }
    /** @deprecated - Switch to `@twitter-api-v2/plugin-rate-limit` */
    getRateLimits() {
        return this.rateLimits;
    }
    saveRateLimit(originalUrl, rateLimit) {
        this.rateLimits[originalUrl] = rateLimit;
    }
    /** Send a new request and returns a wrapped `Promise<TwitterResponse<T>`. */
    async send(requestParams) {
        var _a, _b, _c, _d, _e;
        // Pre-request config hooks
        if ((_a = this.clientSettings.plugins) === null || _a === void 0 ? void 0 : _a.length) {
            const possibleResponse = await this.applyPreRequestConfigHooks(requestParams);
            if (possibleResponse) {
                return possibleResponse;
            }
        }
        const args = this.getHttpRequestArgs(requestParams);
        const options = {
            method: args.method,
            headers: args.headers,
            timeout: requestParams.timeout,
            agent: this.clientSettings.httpAgent,
        };
        const enableRateLimitSave = requestParams.enableRateLimitSave !== false;
        if (args.body) {
            RequestParamHelpers.setBodyLengthHeader(options, args.body);
        }
        // Pre-request hooks
        if ((_b = this.clientSettings.plugins) === null || _b === void 0 ? void 0 : _b.length) {
            await this.applyPreRequestHooks(requestParams, args, options);
        }
        let request = new RequestHandlerHelper({
            url: args.url,
            options,
            body: args.body,
            rateLimitSaver: enableRateLimitSave ? this.saveRateLimit.bind(this, args.rawUrl) : undefined,
            requestEventDebugHandler: requestParams.requestEventDebugHandler,
            compression: (_d = (_c = requestParams.compression) !== null && _c !== void 0 ? _c : this.clientSettings.compression) !== null && _d !== void 0 ? _d : true,
            forceParseMode: requestParams.forceParseMode,
        })
            .makeRequest();
        if (hasRequestErrorPlugins(this)) {
            request = this.applyResponseErrorHooks(requestParams, args, options, request);
        }
        const response = await request;
        // Post-request hooks
        if ((_e = this.clientSettings.plugins) === null || _e === void 0 ? void 0 : _e.length) {
            const responseOverride = await this.applyPostRequestHooks(requestParams, args, options, response);
            if (responseOverride) {
                return responseOverride.value;
            }
        }
        return response;
    }
    sendStream(requestParams) {
        var _a, _b;
        // Pre-request hooks
        if (this.clientSettings.plugins) {
            this.applyPreStreamRequestConfigHooks(requestParams);
        }
        const args = this.getHttpRequestArgs(requestParams);
        const options = {
            method: args.method,
            headers: args.headers,
            agent: this.clientSettings.httpAgent,
        };
        const enableRateLimitSave = requestParams.enableRateLimitSave !== false;
        const enableAutoConnect = requestParams.autoConnect !== false;
        if (args.body) {
            RequestParamHelpers.setBodyLengthHeader(options, args.body);
        }
        const requestData = {
            url: args.url,
            options,
            body: args.body,
            rateLimitSaver: enableRateLimitSave ? this.saveRateLimit.bind(this, args.rawUrl) : undefined,
            payloadIsError: requestParams.payloadIsError,
            compression: (_b = (_a = requestParams.compression) !== null && _a !== void 0 ? _a : this.clientSettings.compression) !== null && _b !== void 0 ? _b : true,
        };
        const stream = new TweetStream(requestData);
        if (!enableAutoConnect) {
            return stream;
        }
        return stream.connect();
    }
    /* Token helpers */
    initializeToken(token) {
        if (typeof token === 'string') {
            this.bearerToken = token;
        }
        else if (typeof token === 'object' && 'appKey' in token) {
            this.consumerToken = token.appKey;
            this.consumerSecret = token.appSecret;
            if (token.accessToken && token.accessSecret) {
                this.accessToken = token.accessToken;
                this.accessSecret = token.accessSecret;
            }
            this._oauth = this.buildOAuth();
        }
        else if (typeof token === 'object' && 'username' in token) {
            const key = encodeURIComponent(token.username) + ':' + encodeURIComponent(token.password);
            this.basicToken = Buffer.from(key).toString('base64');
        }
        else if (typeof token === 'object' && 'clientId' in token) {
            this.clientId = token.clientId;
            this.clientSecret = token.clientSecret;
        }
    }
    getActiveTokens() {
        if (this.bearerToken) {
            return {
                type: 'oauth2',
                bearerToken: this.bearerToken,
            };
        }
        else if (this.basicToken) {
            return {
                type: 'basic',
                token: this.basicToken,
            };
        }
        else if (this.consumerSecret && this._oauth) {
            return {
                type: 'oauth-1.0a',
                appKey: this.consumerToken,
                appSecret: this.consumerSecret,
                accessToken: this.accessToken,
                accessSecret: this.accessSecret,
            };
        }
        else if (this.clientId) {
            return {
                type: 'oauth2-user',
                clientId: this.clientId,
            };
        }
        return { type: 'none' };
    }
    buildOAuth() {
        if (!this.consumerSecret || !this.consumerToken)
            throw new Error('Invalid consumer tokens');
        return new OAuth1Helper({
            consumerKeys: { key: this.consumerToken, secret: this.consumerSecret },
        });
    }
    getOAuthAccessTokens() {
        if (!this.accessSecret || !this.accessToken)
            return;
        return {
            key: this.accessToken,
            secret: this.accessSecret,
        };
    }
    /* Plugin helpers */
    getPlugins() {
        var _a;
        return (_a = this.clientSettings.plugins) !== null && _a !== void 0 ? _a : [];
    }
    hasPlugins() {
        var _a;
        return !!((_a = this.clientSettings.plugins) === null || _a === void 0 ? void 0 : _a.length);
    }
    async applyPluginMethod(method, args) {
        var _a;
        let returnValue;
        for (const plugin of this.getPlugins()) {
            const value = await ((_a = plugin[method]) === null || _a === void 0 ? void 0 : _a.call(plugin, args));
            if (value && value instanceof TwitterApiPluginResponseOverride) {
                returnValue = value;
            }
        }
        return returnValue;
    }
    /* Request helpers */
    writeAuthHeaders({ headers, bodyInSignature, url, method, query, body }) {
        headers = { ...headers };
        if (this.bearerToken) {
            headers.Authorization = 'Bearer ' + this.bearerToken;
        }
        else if (this.basicToken) {
            // Basic auth, to request a bearer token
            headers.Authorization = 'Basic ' + this.basicToken;
        }
        else if (this.clientId && this.clientSecret) {
            // Basic auth with clientId + clientSecret
            headers.Authorization = 'Basic ' + OAuth2Helper.getAuthHeader(this.clientId, this.clientSecret);
        }
        else if (this.consumerSecret && this._oauth) {
            // Merge query and body
            const data = bodyInSignature ? RequestParamHelpers.mergeQueryAndBodyForOAuth(query, body) : query;
            const auth = this._oauth.authorize({
                url: url.toString(),
                method,
                data,
            }, this.getOAuthAccessTokens());
            headers = { ...headers, ...this._oauth.toHeader(auth) };
        }
        return headers;
    }
    getUrlObjectFromUrlString(url) {
        // Add protocol to URL if needed
        if (!url.startsWith('http')) {
            url = 'https://' + url;
        }
        // Convert URL to object that will receive all URL modifications
        return new URL(url);
    }
    getHttpRequestArgs({ url: stringUrl, method, query: rawQuery = {}, body: rawBody = {}, headers, forceBodyMode, enableAuth, params, }) {
        let body = undefined;
        method = method.toUpperCase();
        headers = headers !== null && headers !== void 0 ? headers : {};
        // Add user agent header (Twitter recommends it)
        if (!headers['x-user-agent']) {
            headers['x-user-agent'] = 'Node.twitter-api-v2';
        }
        const url = this.getUrlObjectFromUrlString(stringUrl);
        // URL without query string to save as endpoint name
        const rawUrl = url.origin + url.pathname;
        // Apply URL parameters
        if (params) {
            RequestParamHelpers.applyRequestParametersToUrl(url, params);
        }
        // Build a URL without anything in QS, and QSP in query
        const query = RequestParamHelpers.formatQueryToString(rawQuery);
        RequestParamHelpers.moveUrlQueryParamsIntoObject(url, query);
        // Delete undefined parameters
        if (!(rawBody instanceof Buffer)) {
            trimUndefinedProperties(rawBody);
        }
        // OAuth signature should not include parameters when using multipart.
        const bodyType = forceBodyMode !== null && forceBodyMode !== void 0 ? forceBodyMode : RequestParamHelpers.autoDetectBodyType(url);
        // If undefined or true, enable auth by headers
        if (enableAuth !== false) {
            // OAuth needs body signature only if body is URL encoded.
            const bodyInSignature = ClientRequestMaker.BODY_METHODS.has(method) && bodyType === 'url';
            headers = this.writeAuthHeaders({ headers, bodyInSignature, method, query, url, body: rawBody });
        }
        if (ClientRequestMaker.BODY_METHODS.has(method)) {
            body = RequestParamHelpers.constructBodyParams(rawBody, headers, bodyType) || undefined;
        }
        RequestParamHelpers.addQueryParamsToUrl(url, query);
        return {
            rawUrl,
            url,
            method,
            headers,
            body,
        };
    }
    /* Plugin helpers */
    async applyPreRequestConfigHooks(requestParams) {
        var _a;
        const url = this.getUrlObjectFromUrlString(requestParams.url);
        for (const plugin of this.getPlugins()) {
            const result = await ((_a = plugin.onBeforeRequestConfig) === null || _a === void 0 ? void 0 : _a.call(plugin, {
                client: this,
                url,
                params: requestParams,
            }));
            if (result) {
                return result;
            }
        }
    }
    applyPreStreamRequestConfigHooks(requestParams) {
        var _a;
        const url = this.getUrlObjectFromUrlString(requestParams.url);
        for (const plugin of this.getPlugins()) {
            (_a = plugin.onBeforeStreamRequestConfig) === null || _a === void 0 ? void 0 : _a.call(plugin, {
                client: this,
                url,
                params: requestParams,
            });
        }
    }
    async applyPreRequestHooks(requestParams, computedParams, requestOptions) {
        await this.applyPluginMethod('onBeforeRequest', {
            client: this,
            url: this.getUrlObjectFromUrlString(requestParams.url),
            params: requestParams,
            computedParams,
            requestOptions,
        });
    }
    async applyPostRequestHooks(requestParams, computedParams, requestOptions, response) {
        return await this.applyPluginMethod('onAfterRequest', {
            client: this,
            url: this.getUrlObjectFromUrlString(requestParams.url),
            params: requestParams,
            computedParams,
            requestOptions,
            response,
        });
    }
    applyResponseErrorHooks(requestParams, computedParams, requestOptions, promise) {
        return promise.catch(applyResponseHooks.bind(this, requestParams, computedParams, requestOptions));
    }
}
ClientRequestMaker.BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Base class for Twitter instances
 */
class TwitterApiBase {
    constructor(token, settings = {}) {
        this._currentUser = null;
        this._currentUserV2 = null;
        if (token instanceof TwitterApiBase) {
            this._requestMaker = token._requestMaker;
        }
        else {
            this._requestMaker = new ClientRequestMaker(settings);
            this._requestMaker.initializeToken(token);
        }
    }
    /* Prefix/Token handling */
    setPrefix(prefix) {
        this._prefix = prefix;
    }
    cloneWithPrefix(prefix) {
        const clone = this.constructor(this);
        clone.setPrefix(prefix);
        return clone;
    }
    getActiveTokens() {
        return this._requestMaker.getActiveTokens();
    }
    /* Rate limit cache / Plugins */
    getPlugins() {
        return this._requestMaker.getPlugins();
    }
    getPluginOfType(type) {
        return this.getPlugins().find(plugin => plugin instanceof type);
    }
    /**
     * @deprecated - Migrate to plugin `@twitter-api-v2/plugin-rate-limit`
     *
     * Tells if you hit the Twitter rate limit for {endpoint}.
     * (local data only, this should not ask anything to Twitter)
     */
    hasHitRateLimit(endpoint) {
        var _a;
        if (this.isRateLimitStatusObsolete(endpoint)) {
            return false;
        }
        return ((_a = this.getLastRateLimitStatus(endpoint)) === null || _a === void 0 ? void 0 : _a.remaining) === 0;
    }
    /**
     * @deprecated - Migrate to plugin `@twitter-api-v2/plugin-rate-limit`
     *
     * Tells if you hit the returned Twitter rate limit for {endpoint} has expired.
     * If client has no saved rate limit data for {endpoint}, this will gives you `true`.
     */
    isRateLimitStatusObsolete(endpoint) {
        const rateLimit = this.getLastRateLimitStatus(endpoint);
        if (rateLimit === undefined) {
            return true;
        }
        // Timestamps are exprimed in seconds, JS works with ms
        return (rateLimit.reset * 1000) < Date.now();
    }
    /**
     * @deprecated - Migrate to plugin `@twitter-api-v2/plugin-rate-limit`
     *
     * Get the last obtained Twitter rate limit information for {endpoint}.
     * (local data only, this should not ask anything to Twitter)
     */
    getLastRateLimitStatus(endpoint) {
        const endpointWithPrefix = endpoint.match(/^https?:\/\//) ? endpoint : (this._prefix + endpoint);
        return this._requestMaker.getRateLimits()[endpointWithPrefix];
    }
    /* Current user cache */
    /** Get cached current user. */
    getCurrentUserObject(forceFetch = false) {
        if (!forceFetch && this._currentUser) {
            if (this._currentUser.value) {
                return Promise.resolve(this._currentUser.value);
            }
            return this._currentUser.promise;
        }
        this._currentUser = sharedPromise(() => this.get('account/verify_credentials.json', { tweet_mode: 'extended' }, { prefix: API_V1_1_PREFIX }));
        return this._currentUser.promise;
    }
    /**
     * Get cached current user from v2 API.
     * This can only be the slimest available `UserV2` object, with only `id`, `name` and `username` properties defined.
     *
     * To get a customized `UserV2Result`, use `.v2.me()`
     *
     * OAuth2 scopes: `tweet.read` & `users.read`
     */
    getCurrentUserV2Object(forceFetch = false) {
        if (!forceFetch && this._currentUserV2) {
            if (this._currentUserV2.value) {
                return Promise.resolve(this._currentUserV2.value);
            }
            return this._currentUserV2.promise;
        }
        this._currentUserV2 = sharedPromise(() => this.get('users/me', undefined, { prefix: API_V2_PREFIX }));
        return this._currentUserV2.promise;
    }
    async get(url, query = {}, { fullResponse, prefix = this._prefix, ...rest } = {}) {
        if (prefix)
            url = prefix + url;
        const resp = await this._requestMaker.send({
            url,
            method: 'GET',
            query,
            ...rest,
        });
        return fullResponse ? resp : resp.data;
    }
    async delete(url, query = {}, { fullResponse, prefix = this._prefix, ...rest } = {}) {
        if (prefix)
            url = prefix + url;
        const resp = await this._requestMaker.send({
            url,
            method: 'DELETE',
            query,
            ...rest,
        });
        return fullResponse ? resp : resp.data;
    }
    async post(url, body, { fullResponse, prefix = this._prefix, ...rest } = {}) {
        if (prefix)
            url = prefix + url;
        const resp = await this._requestMaker.send({
            url,
            method: 'POST',
            body,
            ...rest,
        });
        return fullResponse ? resp : resp.data;
    }
    async put(url, body, { fullResponse, prefix = this._prefix, ...rest } = {}) {
        if (prefix)
            url = prefix + url;
        const resp = await this._requestMaker.send({
            url,
            method: 'PUT',
            body,
            ...rest,
        });
        return fullResponse ? resp : resp.data;
    }
    async patch(url, body, { fullResponse, prefix = this._prefix, ...rest } = {}) {
        if (prefix)
            url = prefix + url;
        const resp = await this._requestMaker.send({
            url,
            method: 'PATCH',
            body,
            ...rest,
        });
        return fullResponse ? resp : resp.data;
    }
    getStream(url, query, { prefix = this._prefix, ...rest } = {}) {
        return this._requestMaker.sendStream({
            url: prefix ? prefix + url : url,
            method: 'GET',
            query,
            ...rest,
        });
    }
    postStream(url, body, { prefix = this._prefix, ...rest } = {}) {
        return this._requestMaker.sendStream({
            url: prefix ? prefix + url : url,
            method: 'POST',
            body,
            ...rest,
        });
    }
}

/**
 * Base subclient for every v1 and v2 client.
 */
class TwitterApiSubClient extends TwitterApiBase {
    constructor(instance) {
        if (!(instance instanceof TwitterApiBase)) {
            throw new Error('You must instance SubTwitterApi instance from existing TwitterApi instance.');
        }
        super(instance);
    }
}

/** A generic TwitterPaginator able to consume TweetV1 timelines. */
class TweetTimelineV1Paginator extends TwitterPaginator {
    constructor() {
        super(...arguments);
        this.hasFinishedFetch = false;
    }
    refreshInstanceFromResult(response, isNextPage) {
        const result = response.data;
        this._rateLimit = response.rateLimit;
        if (isNextPage) {
            this._realData.push(...result);
            // HINT: This is an approximation, as "end" of pagination cannot be safely determined without cursors.
            this.hasFinishedFetch = result.length === 0;
        }
    }
    getNextQueryParams(maxResults) {
        const latestId = BigInt(this._realData[this._realData.length - 1].id_str);
        return {
            ...this.injectQueryParams(maxResults),
            max_id: (latestId - BigInt(1)).toString(),
        };
    }
    getPageLengthFromRequest(result) {
        return result.data.length;
    }
    isFetchLastOver(result) {
        return !result.data.length;
    }
    canFetchNextPage(result) {
        return result.length > 0;
    }
    getItemArray() {
        return this.tweets;
    }
    /**
     * Tweets returned by paginator.
     */
    get tweets() {
        return this._realData;
    }
    get done() {
        return super.done || this.hasFinishedFetch;
    }
}
// Timelines
// Home
class HomeTimelineV1Paginator extends TweetTimelineV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'statuses/home_timeline.json';
    }
}
// Mention
class MentionTimelineV1Paginator extends TweetTimelineV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'statuses/mentions_timeline.json';
    }
}
// User
class UserTimelineV1Paginator extends TweetTimelineV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'statuses/user_timeline.json';
    }
}
// Lists
class ListTimelineV1Paginator extends TweetTimelineV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'lists/statuses.json';
    }
}
// Favorites
class UserFavoritesV1Paginator extends TweetTimelineV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'favorites/list.json';
    }
}

class MuteUserListV1Paginator extends CursoredV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'mutes/users/list.json';
    }
    refreshInstanceFromResult(response, isNextPage) {
        const result = response.data;
        this._rateLimit = response.rateLimit;
        if (isNextPage) {
            this._realData.users.push(...result.users);
            this._realData.next_cursor = result.next_cursor;
        }
    }
    getPageLengthFromRequest(result) {
        return result.data.users.length;
    }
    getItemArray() {
        return this.users;
    }
    /**
     * Users returned by paginator.
     */
    get users() {
        return this._realData.users;
    }
}
class MuteUserIdsV1Paginator extends CursoredV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'mutes/users/ids.json';
        this._maxResultsWhenFetchLast = 5000;
    }
    refreshInstanceFromResult(response, isNextPage) {
        const result = response.data;
        this._rateLimit = response.rateLimit;
        if (isNextPage) {
            this._realData.ids.push(...result.ids);
            this._realData.next_cursor = result.next_cursor;
        }
    }
    getPageLengthFromRequest(result) {
        return result.data.ids.length;
    }
    getItemArray() {
        return this.ids;
    }
    /**
     * Users IDs returned by paginator.
     */
    get ids() {
        return this._realData.ids;
    }
}

class UserFollowerListV1Paginator extends CursoredV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'followers/list.json';
    }
    refreshInstanceFromResult(response, isNextPage) {
        const result = response.data;
        this._rateLimit = response.rateLimit;
        if (isNextPage) {
            this._realData.users.push(...result.users);
            this._realData.next_cursor = result.next_cursor;
        }
    }
    getPageLengthFromRequest(result) {
        return result.data.users.length;
    }
    getItemArray() {
        return this.users;
    }
    /**
     * Users returned by paginator.
     */
    get users() {
        return this._realData.users;
    }
}
class UserFollowerIdsV1Paginator extends CursoredV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'followers/ids.json';
        this._maxResultsWhenFetchLast = 5000;
    }
    refreshInstanceFromResult(response, isNextPage) {
        const result = response.data;
        this._rateLimit = response.rateLimit;
        if (isNextPage) {
            this._realData.ids.push(...result.ids);
            this._realData.next_cursor = result.next_cursor;
        }
    }
    getPageLengthFromRequest(result) {
        return result.data.ids.length;
    }
    getItemArray() {
        return this.ids;
    }
    /**
     * Users IDs returned by paginator.
     */
    get ids() {
        return this._realData.ids;
    }
}

class UserFriendListV1Paginator extends CursoredV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'friends/list.json';
    }
    refreshInstanceFromResult(response, isNextPage) {
        const result = response.data;
        this._rateLimit = response.rateLimit;
        if (isNextPage) {
            this._realData.users.push(...result.users);
            this._realData.next_cursor = result.next_cursor;
        }
    }
    getPageLengthFromRequest(result) {
        return result.data.users.length;
    }
    getItemArray() {
        return this.users;
    }
    /**
     * Users returned by paginator.
     */
    get users() {
        return this._realData.users;
    }
}
class UserFollowersIdsV1Paginator extends CursoredV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'friends/ids.json';
        this._maxResultsWhenFetchLast = 5000;
    }
    refreshInstanceFromResult(response, isNextPage) {
        const result = response.data;
        this._rateLimit = response.rateLimit;
        if (isNextPage) {
            this._realData.ids.push(...result.ids);
            this._realData.next_cursor = result.next_cursor;
        }
    }
    getPageLengthFromRequest(result) {
        return result.data.ids.length;
    }
    getItemArray() {
        return this.ids;
    }
    /**
     * Users IDs returned by paginator.
     */
    get ids() {
        return this._realData.ids;
    }
}

/** A generic TwitterPaginator able to consume TweetV1 timelines. */
class UserSearchV1Paginator extends TwitterPaginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'users/search.json';
    }
    refreshInstanceFromResult(response, isNextPage) {
        const result = response.data;
        this._rateLimit = response.rateLimit;
        if (isNextPage) {
            this._realData.push(...result);
        }
    }
    getNextQueryParams(maxResults) {
        var _a;
        const previousPage = Number((_a = this._queryParams.page) !== null && _a !== void 0 ? _a : '1');
        return {
            ...this._queryParams,
            page: previousPage + 1,
            ...maxResults ? { count: maxResults } : {},
        };
    }
    getPageLengthFromRequest(result) {
        return result.data.length;
    }
    isFetchLastOver(result) {
        return !result.data.length;
    }
    canFetchNextPage(result) {
        return result.length > 0;
    }
    getItemArray() {
        return this.users;
    }
    /**
     * Users returned by paginator.
     */
    get users() {
        return this._realData;
    }
}
class FriendshipsIncomingV1Paginator extends CursoredV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'friendships/incoming.json';
        this._maxResultsWhenFetchLast = 5000;
    }
    refreshInstanceFromResult(response, isNextPage) {
        const result = response.data;
        this._rateLimit = response.rateLimit;
        if (isNextPage) {
            this._realData.ids.push(...result.ids);
            this._realData.next_cursor = result.next_cursor;
        }
    }
    getPageLengthFromRequest(result) {
        return result.data.ids.length;
    }
    getItemArray() {
        return this.ids;
    }
    /**
     * Users IDs returned by paginator.
     */
    get ids() {
        return this._realData.ids;
    }
}
class FriendshipsOutgoingV1Paginator extends FriendshipsIncomingV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'friendships/outgoing.json';
    }
}

class ListListsV1Paginator extends CursoredV1Paginator {
    refreshInstanceFromResult(response, isNextPage) {
        const result = response.data;
        this._rateLimit = response.rateLimit;
        if (isNextPage) {
            this._realData.lists.push(...result.lists);
            this._realData.next_cursor = result.next_cursor;
        }
    }
    getPageLengthFromRequest(result) {
        return result.data.lists.length;
    }
    getItemArray() {
        return this.lists;
    }
    /**
     * Lists returned by paginator.
     */
    get lists() {
        return this._realData.lists;
    }
}
class ListMembershipsV1Paginator extends ListListsV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'lists/memberships.json';
    }
}
class ListOwnershipsV1Paginator extends ListListsV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'lists/ownerships.json';
    }
}
class ListSubscriptionsV1Paginator extends ListListsV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'lists/subscriptions.json';
    }
}
class ListUsersV1Paginator extends CursoredV1Paginator {
    refreshInstanceFromResult(response, isNextPage) {
        const result = response.data;
        this._rateLimit = response.rateLimit;
        if (isNextPage) {
            this._realData.users.push(...result.users);
            this._realData.next_cursor = result.next_cursor;
        }
    }
    getPageLengthFromRequest(result) {
        return result.data.users.length;
    }
    getItemArray() {
        return this.users;
    }
    /**
     * Users returned by paginator.
     */
    get users() {
        return this._realData.users;
    }
}
class ListMembersV1Paginator extends ListUsersV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'lists/members.json';
    }
}
class ListSubscribersV1Paginator extends ListUsersV1Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'lists/subscribers.json';
    }
}

/**
 * Base Twitter v1 client with only read right.
 */
class TwitterApiv1ReadOnly extends TwitterApiSubClient {
    constructor() {
        super(...arguments);
        this._prefix = API_V1_1_PREFIX;
    }
    /* Tweets */
    /**
     * Returns a single Tweet, specified by the id parameter. The Tweet's author will also be embedded within the Tweet.
     * https://developer.twitter.com/en/docs/twitter-api/v1/tweets/post-and-engage/api-reference/get-statuses-show-id
     */
    singleTweet(tweetId, options = {}) {
        return this.get('statuses/show.json', { tweet_mode: 'extended', id: tweetId, ...options });
    }
    tweets(ids, options = {}) {
        return this.post('statuses/lookup.json', { tweet_mode: 'extended', id: ids, ...options });
    }
    /**
     * Returns a single Tweet, specified by either a Tweet web URL or the Tweet ID, in an oEmbed-compatible format.
     * The returned HTML snippet will be automatically recognized as an Embedded Tweet when Twitter's widget JavaScript is included on the page.
     * https://developer.twitter.com/en/docs/twitter-api/v1/tweets/post-and-engage/api-reference/get-statuses-oembed
     */
    oembedTweet(tweetId, options = {}) {
        return this.get('oembed', {
            url: `https://twitter.com/i/statuses/${tweetId}`,
            ...options,
        }, { prefix: 'https://publish.twitter.com/' });
    }
    /* Tweets timelines */
    /**
     * Returns a collection of the most recent Tweets and Retweets posted by the authenticating user and the users they follow.
     * The home timeline is central to how most users interact with the Twitter service.
     * https://developer.twitter.com/en/docs/twitter-api/v1/tweets/timelines/api-reference/get-statuses-home_timeline
     */
    async homeTimeline(options = {}) {
        const queryParams = {
            tweet_mode: 'extended',
            ...options,
        };
        const initialRq = await this.get('statuses/home_timeline.json', queryParams, { fullResponse: true });
        return new HomeTimelineV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Returns the 20 most recent mentions (Tweets containing a users's @screen_name) for the authenticating user.
     * The timeline returned is the equivalent of the one seen when you view your mentions on twitter.com.
     * https://developer.twitter.com/en/docs/twitter-api/v1/tweets/timelines/api-reference/get-statuses-mentions_timeline
     */
    async mentionTimeline(options = {}) {
        const queryParams = {
            tweet_mode: 'extended',
            ...options,
        };
        const initialRq = await this.get('statuses/mentions_timeline.json', queryParams, { fullResponse: true });
        return new MentionTimelineV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Returns a collection of the most recent Tweets posted by the user indicated by the user_id parameters.
     * User timelines belonging to protected users may only be requested when the authenticated user either "owns" the timeline or is an approved follower of the owner.
     * https://developer.twitter.com/en/docs/twitter-api/v1/tweets/timelines/api-reference/get-statuses-user_timeline
     */
    async userTimeline(userId, options = {}) {
        const queryParams = {
            tweet_mode: 'extended',
            user_id: userId,
            ...options,
        };
        const initialRq = await this.get('statuses/user_timeline.json', queryParams, { fullResponse: true });
        return new UserTimelineV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Returns a collection of the most recent Tweets posted by the user indicated by the screen_name parameters.
     * User timelines belonging to protected users may only be requested when the authenticated user either "owns" the timeline or is an approved follower of the owner.
     * https://developer.twitter.com/en/docs/twitter-api/v1/tweets/timelines/api-reference/get-statuses-user_timeline
     */
    async userTimelineByUsername(username, options = {}) {
        const queryParams = {
            tweet_mode: 'extended',
            screen_name: username,
            ...options,
        };
        const initialRq = await this.get('statuses/user_timeline.json', queryParams, { fullResponse: true });
        return new UserTimelineV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Returns the most recent Tweets liked by the authenticating or specified user, 20 tweets by default.
     * Note: favorites are now known as likes.
     * https://developer.twitter.com/en/docs/twitter-api/v1/tweets/post-and-engage/api-reference/get-favorites-list
     */
    async favoriteTimeline(userId, options = {}) {
        const queryParams = {
            tweet_mode: 'extended',
            user_id: userId,
            ...options,
        };
        const initialRq = await this.get('favorites/list.json', queryParams, { fullResponse: true });
        return new UserFavoritesV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Returns the most recent Tweets liked by the authenticating or specified user, 20 tweets by default.
     * Note: favorites are now known as likes.
     * https://developer.twitter.com/en/docs/twitter-api/v1/tweets/post-and-engage/api-reference/get-favorites-list
     */
    async favoriteTimelineByUsername(username, options = {}) {
        const queryParams = {
            tweet_mode: 'extended',
            screen_name: username,
            ...options,
        };
        const initialRq = await this.get('favorites/list.json', queryParams, { fullResponse: true });
        return new UserFavoritesV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /* Users */
    /**
     * Returns a variety of information about the user specified by the required user_id or screen_name parameter.
     * The author's most recent Tweet will be returned inline when possible.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/get-users-show
     */
    user(user) {
        return this.get('users/show.json', { tweet_mode: 'extended', ...user });
    }
    /**
     * Returns fully-hydrated user objects for up to 100 users per request,
     * as specified by comma-separated values passed to the user_id and/or screen_name parameters.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/get-users-lookup
     */
    users(query) {
        return this.get('users/lookup.json', { tweet_mode: 'extended', ...query });
    }
    /**
     * Returns an HTTP 200 OK response code and a representation of the requesting user if authentication was successful;
     * returns a 401 status code and an error message if not.
     * Use this method to test if supplied user credentials are valid.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/manage-account-settings/api-reference/get-account-verify_credentials
     */
    verifyCredentials(options = {}) {
        return this.get('account/verify_credentials.json', options);
    }
    /**
     * Returns an array of user objects the authenticating user has muted.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/mute-block-report-users/api-reference/get-mutes-users-list
     */
    async listMutedUsers(options = {}) {
        const queryParams = {
            tweet_mode: 'extended',
            ...options,
        };
        const initialRq = await this.get('mutes/users/list.json', queryParams, { fullResponse: true });
        return new MuteUserListV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Returns an array of numeric user ids the authenticating user has muted.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/mute-block-report-users/api-reference/get-mutes-users-ids
     */
    async listMutedUserIds(options = {}) {
        const queryParams = {
            stringify_ids: true,
            ...options,
        };
        const initialRq = await this.get('mutes/users/ids.json', queryParams, { fullResponse: true });
        return new MuteUserIdsV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Returns an array of user objects of friends of the specified user.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/get-friends-list
     */
    async userFriendList(options = {}) {
        const queryParams = {
            ...options,
        };
        const initialRq = await this.get('friends/list.json', queryParams, { fullResponse: true });
        return new UserFriendListV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Returns an array of user objects of followers of the specified user.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/get-followers-list
     */
    async userFollowerList(options = {}) {
        const queryParams = {
            ...options,
        };
        const initialRq = await this.get('followers/list.json', queryParams, { fullResponse: true });
        return new UserFollowerListV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Returns an array of numeric user ids of followers of the specified user.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/get-followers-ids
     */
    async userFollowerIds(options = {}) {
        const queryParams = {
            stringify_ids: true,
            ...options,
        };
        const initialRq = await this.get('followers/ids.json', queryParams, { fullResponse: true });
        return new UserFollowerIdsV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Returns an array of numeric user ids of friends of the specified user.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/get-friends-ids
     */
    async userFollowingIds(options = {}) {
        const queryParams = {
            stringify_ids: true,
            ...options,
        };
        const initialRq = await this.get('friends/ids.json', queryParams, { fullResponse: true });
        return new UserFollowersIdsV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Provides a simple, relevance-based search interface to public user accounts on Twitter.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/get-users-search
     */
    async searchUsers(query, options = {}) {
        const queryParams = {
            q: query,
            tweet_mode: 'extended',
            page: 1,
            ...options,
        };
        const initialRq = await this.get('users/search.json', queryParams, { fullResponse: true });
        return new UserSearchV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /* Friendship API */
    /**
     * Returns detailed information about the relationship between two arbitrary users.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/get-friendships-show
     */
    friendship(sources) {
        return this.get('friendships/show.json', sources);
    }
    /**
     * Returns the relationships of the authenticating user to the comma-separated list of up to 100 screen_names or user_ids provided.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/get-friendships-lookup
     */
    friendships(friendships) {
        return this.get('friendships/lookup.json', friendships);
    }
    /**
     * Returns a collection of user_ids that the currently authenticated user does not want to receive retweets from.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/get-friendships-no_retweets-ids
     */
    friendshipsNoRetweets() {
        return this.get('friendships/no_retweets/ids.json', { stringify_ids: true });
    }
    /**
     * Returns a collection of numeric IDs for every user who has a pending request to follow the authenticating user.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/get-friendships-incoming
     */
    async friendshipsIncoming(options = {}) {
        const queryParams = {
            stringify_ids: true,
            ...options,
        };
        const initialRq = await this.get('friendships/incoming.json', queryParams, { fullResponse: true });
        return new FriendshipsIncomingV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Returns a collection of numeric IDs for every protected user for whom the authenticating user has a pending follow request.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/get-friendships-outgoing
     */
    async friendshipsOutgoing(options = {}) {
        const queryParams = {
            stringify_ids: true,
            ...options,
        };
        const initialRq = await this.get('friendships/outgoing.json', queryParams, { fullResponse: true });
        return new FriendshipsOutgoingV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /* Account/user API */
    /**
     * Get current account settings for authenticating user.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/manage-account-settings/api-reference/get-account-settings
     */
    accountSettings() {
        return this.get('account/settings.json');
    }
    /**
     * Returns a map of the available size variations of the specified user's profile banner.
     * If the user has not uploaded a profile banner, a HTTP 404 will be served instead.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/manage-account-settings/api-reference/get-users-profile_banner
     */
    userProfileBannerSizes(params) {
        return this.get('users/profile_banner.json', params);
    }
    /* Lists */
    /**
     * Returns the specified list. Private lists will only be shown if the authenticated user owns the specified list.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/create-manage-lists/api-reference/get-lists-show
     */
    list(options) {
        return this.get('lists/show.json', { tweet_mode: 'extended', ...options });
    }
    /**
     * Returns all lists the authenticating or specified user subscribes to, including their own.
     * If no user is given, the authenticating user is used.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/create-manage-lists/api-reference/get-lists-list
     */
    lists(options = {}) {
        return this.get('lists/list.json', { tweet_mode: 'extended', ...options });
    }
    /**
     * Returns the members of the specified list. Private list members will only be shown if the authenticated user owns the specified list.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/create-manage-lists/api-reference/get-lists-members
     */
    async listMembers(options = {}) {
        const queryParams = {
            tweet_mode: 'extended',
            ...options,
        };
        const initialRq = await this.get('lists/members.json', queryParams, { fullResponse: true });
        return new ListMembersV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Check if the specified user is a member of the specified list.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/create-manage-lists/api-reference/get-lists-members-show
     */
    listGetMember(options) {
        return this.get('lists/members/show.json', { tweet_mode: 'extended', ...options });
    }
    /**
     * Returns the lists the specified user has been added to.
     * If user_id or screen_name are not provided, the memberships for the authenticating user are returned.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/create-manage-lists/api-reference/get-lists-memberships
     */
    async listMemberships(options = {}) {
        const queryParams = {
            tweet_mode: 'extended',
            ...options,
        };
        const initialRq = await this.get('lists/memberships.json', queryParams, { fullResponse: true });
        return new ListMembershipsV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Returns the lists owned by the specified Twitter user. Private lists will only be shown if the authenticated user is also the owner of the lists.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/create-manage-lists/api-reference/get-lists-ownerships
     */
    async listOwnerships(options = {}) {
        const queryParams = {
            tweet_mode: 'extended',
            ...options,
        };
        const initialRq = await this.get('lists/ownerships.json', queryParams, { fullResponse: true });
        return new ListOwnershipsV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Returns a timeline of tweets authored by members of the specified list. Retweets are included by default.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/create-manage-lists/api-reference/get-lists-statuses
     */
    async listStatuses(options) {
        const queryParams = {
            tweet_mode: 'extended',
            ...options,
        };
        const initialRq = await this.get('lists/statuses.json', queryParams, { fullResponse: true });
        return new ListTimelineV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Returns the subscribers of the specified list. Private list subscribers will only be shown if the authenticated user owns the specified list.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/create-manage-lists/api-reference/get-lists-subscribers
     */
    async listSubscribers(options = {}) {
        const queryParams = {
            tweet_mode: 'extended',
            ...options,
        };
        const initialRq = await this.get('lists/subscribers.json', queryParams, { fullResponse: true });
        return new ListSubscribersV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Check if the specified user is a subscriber of the specified list. Returns the user if they are a subscriber.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/create-manage-lists/api-reference/get-lists-subscribers-show
     */
    listGetSubscriber(options) {
        return this.get('lists/subscribers/show.json', { tweet_mode: 'extended', ...options });
    }
    /**
     * Obtain a collection of the lists the specified user is subscribed to, 20 lists per page by default.
     * Does not include the user's own lists.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/create-manage-lists/api-reference/get-lists-subscriptions
     */
    async listSubscriptions(options = {}) {
        const queryParams = {
            tweet_mode: 'extended',
            ...options,
        };
        const initialRq = await this.get('lists/subscriptions.json', queryParams, { fullResponse: true });
        return new ListSubscriptionsV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /* Media upload API */
    /**
     * The STATUS command (this method) is used to periodically poll for updates of media processing operation.
     * After the STATUS command response returns succeeded, you can move on to the next step which is usually create Tweet with media_id.
     * https://developer.twitter.com/en/docs/twitter-api/v1/media/upload-media/api-reference/get-media-upload-status
     */
    mediaInfo(mediaId) {
        return this.get('media/upload.json', {
            command: 'STATUS',
            media_id: mediaId,
        }, { prefix: API_V1_1_UPLOAD_PREFIX });
    }
    filterStream({ autoConnect, ...params } = {}) {
        const parameters = {};
        for (const [key, value] of Object.entries(params)) {
            if (key === 'follow' || key === 'track') {
                parameters[key] = value.toString();
            }
            else if (key === 'locations') {
                const locations = value;
                parameters.locations = arrayWrap(locations).map(loc => `${loc.lng},${loc.lat}`).join(',');
            }
            else {
                parameters[key] = value;
            }
        }
        const streamClient = this.stream;
        return streamClient.postStream('statuses/filter.json', parameters, { autoConnect });
    }
    sampleStream({ autoConnect, ...params } = {}) {
        const streamClient = this.stream;
        return streamClient.getStream('statuses/sample.json', params, { autoConnect });
    }
    /**
     * Create a client that is prefixed with `https//stream.twitter.com` instead of classic API URL.
     */
    get stream() {
        const copiedClient = new TwitterApiv1(this);
        copiedClient.setPrefix(API_V1_1_STREAM_PREFIX);
        return copiedClient;
    }
    /* Trends API */
    /**
     * Returns the top 50 trending topics for a specific id, if trending information is available for it.
     * Note: The id parameter for this endpoint is the "where on earth identifier" or WOEID, which is a legacy identifier created by Yahoo and has been deprecated.
     * https://developer.twitter.com/en/docs/twitter-api/v1/trends/trends-for-location/api-reference/get-trends-place
     */
    trendsByPlace(woeId, options = {}) {
        return this.get('trends/place.json', { id: woeId, ...options });
    }
    /**
     * Returns the locations that Twitter has trending topic information for.
     * The response is an array of "locations" that encode the location's WOEID
     * and some other human-readable information such as a canonical name and country the location belongs in.
     * https://developer.twitter.com/en/docs/twitter-api/v1/trends/locations-with-trending-topics/api-reference/get-trends-available
     */
    trendsAvailable() {
        return this.get('trends/available.json');
    }
    /**
     * Returns the locations that Twitter has trending topic information for, closest to a specified location.
     * https://developer.twitter.com/en/docs/twitter-api/v1/trends/locations-with-trending-topics/api-reference/get-trends-closest
     */
    trendsClosest(lat, long) {
        return this.get('trends/closest.json', { lat, long });
    }
    /* Geo API */
    /**
     * Returns all the information about a known place.
     * https://developer.twitter.com/en/docs/twitter-api/v1/geo/place-information/api-reference/get-geo-id-place_id
     */
    geoPlace(placeId) {
        return this.get('geo/id/:place_id.json', undefined, { params: { place_id: placeId } });
    }
    /**
     * Search for places that can be attached to a Tweet via POST statuses/update.
     * This request will return a list of all the valid places that can be used as the place_id when updating a status.
     * https://developer.twitter.com/en/docs/twitter-api/v1/geo/places-near-location/api-reference/get-geo-search
     */
    geoSearch(options) {
        return this.get('geo/search.json', options);
    }
    /**
     * Given a latitude and a longitude, searches for up to 20 places that can be used as a place_id when updating a status.
     * This request is an informative call and will deliver generalized results about geography.
     * https://developer.twitter.com/en/docs/twitter-api/v1/geo/places-near-location/api-reference/get-geo-reverse_geocode
     */
    geoReverseGeoCode(options) {
        return this.get('geo/reverse_geocode.json', options);
    }
    /* Developer utilities */
    /**
     * Returns the current rate limits for methods belonging to the specified resource families.
     * Each API resource belongs to a "resource family" which is indicated in its method documentation.
     * The method's resource family can be determined from the first component of the path after the resource version.
     * https://developer.twitter.com/en/docs/twitter-api/v1/developer-utilities/rate-limit-status/api-reference/get-application-rate_limit_status
     */
    rateLimitStatuses(...resources) {
        return this.get('application/rate_limit_status.json', { resources });
    }
    /**
     * Returns the list of languages supported by Twitter along with the language code supported by Twitter.
     * https://developer.twitter.com/en/docs/twitter-api/v1/developer-utilities/supported-languages/api-reference/get-help-languages
     */
    supportedLanguages() {
        return this.get('help/languages.json');
    }
}

async function readFileIntoBuffer(file) {
    const handle = await getFileHandle(file);
    if (typeof handle === 'number') {
        return new Promise((resolve, reject) => {
            fs__namespace.readFile(handle, (err, data) => {
                if (err) {
                    return reject(err);
                }
                resolve(data);
            });
        });
    }
    else if (handle instanceof Buffer) {
        return handle;
    }
    else {
        return handle.readFile();
    }
}
function getFileHandle(file) {
    if (typeof file === 'string') {
        return fs__namespace.promises.open(file, 'r');
    }
    else if (typeof file === 'number') {
        return file;
    }
    else if (typeof file === 'object' && !(file instanceof Buffer)) {
        return file;
    }
    else if (!(file instanceof Buffer)) {
        throw new Error('Given file is not valid, please check its type.');
    }
    else {
        return file;
    }
}
async function getFileSizeFromFileHandle(fileHandle) {
    // Get the file size
    if (typeof fileHandle === 'number') {
        const stats = await new Promise((resolve, reject) => {
            fs__namespace.fstat(fileHandle, (err, stats) => {
                if (err)
                    reject(err);
                resolve(stats);
            });
        });
        return stats.size;
    }
    else if (fileHandle instanceof Buffer) {
        return fileHandle.length;
    }
    else {
        return (await fileHandle.stat()).size;
    }
}
function getMimeType(file, type, mimeType) {
    if (typeof mimeType === 'string') {
        return mimeType;
    }
    else if (typeof file === 'string' && !type) {
        return getMimeByName(file);
    }
    else if (typeof type === 'string') {
        return getMimeByType(type);
    }
    throw new Error('You must specify type if file is a file handle or Buffer.');
}
function getMimeByName(name) {
    if (name.endsWith('.jpeg') || name.endsWith('.jpg'))
        return EUploadMimeType.Jpeg;
    if (name.endsWith('.png'))
        return EUploadMimeType.Png;
    if (name.endsWith('.webp'))
        return EUploadMimeType.Webp;
    if (name.endsWith('.gif'))
        return EUploadMimeType.Gif;
    if (name.endsWith('.mpeg4') || name.endsWith('.mp4'))
        return EUploadMimeType.Mp4;
    if (name.endsWith('.mov') || name.endsWith('.mov'))
        return EUploadMimeType.Mov;
    if (name.endsWith('.srt'))
        return EUploadMimeType.Srt;
    safeDeprecationWarning({
        instance: 'TwitterApiv1ReadWrite',
        method: 'uploadMedia',
        problem: 'options.mimeType is missing and filename couldn\'t help to resolve MIME type, so it will fallback to image/jpeg',
        resolution: 'If you except to give filenames without extensions, please specify explicitlty the MIME type using options.mimeType',
    });
    return EUploadMimeType.Jpeg;
}
function getMimeByType(type) {
    safeDeprecationWarning({
        instance: 'TwitterApiv1ReadWrite',
        method: 'uploadMedia',
        problem: 'you\'re using options.type',
        resolution: 'Remove options.type argument and migrate to options.mimeType which takes the real MIME type. ' +
            'If you\'re using type=longmp4, add options.longVideo alongside of mimeType=EUploadMimeType.Mp4',
    });
    if (type === 'gif')
        return EUploadMimeType.Gif;
    if (type === 'jpg')
        return EUploadMimeType.Jpeg;
    if (type === 'png')
        return EUploadMimeType.Png;
    if (type === 'webp')
        return EUploadMimeType.Webp;
    if (type === 'srt')
        return EUploadMimeType.Srt;
    if (type === 'mp4' || type === 'longmp4')
        return EUploadMimeType.Mp4;
    if (type === 'mov')
        return EUploadMimeType.Mov;
    return type;
}
function getMediaCategoryByMime(name, target) {
    if (name === EUploadMimeType.Mp4 || name === EUploadMimeType.Mov)
        return target === 'tweet' ? 'TweetVideo' : 'DmVideo';
    if (name === EUploadMimeType.Gif)
        return target === 'tweet' ? 'TweetGif' : 'DmGif';
    if (name === EUploadMimeType.Srt)
        return 'Subtitles';
    else
        return target === 'tweet' ? 'TweetImage' : 'DmImage';
}
function sleepSecs(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}
async function readNextPartOf(file, chunkLength, bufferOffset = 0, buffer) {
    if (file instanceof Buffer) {
        const rt = file.slice(bufferOffset, bufferOffset + chunkLength);
        return [rt, rt.length];
    }
    if (!buffer) {
        throw new Error('Well, we will need a buffer to store file content.');
    }
    let bytesRead;
    if (typeof file === 'number') {
        bytesRead = await new Promise((resolve, reject) => {
            fs__namespace.read(file, buffer, 0, chunkLength, bufferOffset, (err, nread) => {
                if (err)
                    reject(err);
                resolve(nread);
            });
        });
    }
    else {
        const res = await file.read(buffer, 0, chunkLength, bufferOffset);
        bytesRead = res.bytesRead;
    }
    return [buffer, bytesRead];
}

const UPLOAD_ENDPOINT = 'media/upload.json';
/**
 * Base Twitter v1 client with read/write rights.
 */
class TwitterApiv1ReadWrite extends TwitterApiv1ReadOnly {
    constructor() {
        super(...arguments);
        this._prefix = API_V1_1_PREFIX;
    }
    /**
     * Get a client with only read rights.
     */
    get readOnly() {
        return this;
    }
    /* Tweet API */
    /**
     * Post a new tweet.
     * https://developer.twitter.com/en/docs/twitter-api/v1/tweets/post-and-engage/api-reference/post-statuses-update
     */
    tweet(status, payload = {}) {
        const queryParams = {
            status,
            tweet_mode: 'extended',
            ...payload,
        };
        return this.post('statuses/update.json', queryParams);
    }
    /**
     * Quote an existing tweet.
     * https://developer.twitter.com/en/docs/twitter-api/v1/tweets/post-and-engage/api-reference/post-statuses-update
     */
    async quote(status, quotingStatusId, payload = {}) {
        const url = 'https://twitter.com/i/statuses/' + quotingStatusId;
        return this.tweet(status, { ...payload, attachment_url: url });
    }
    /**
     * Post a series of tweets.
     * https://developer.twitter.com/en/docs/twitter-api/v1/tweets/post-and-engage/api-reference/post-statuses-update
     */
    async tweetThread(tweets) {
        const postedTweets = [];
        for (const tweet of tweets) {
            // Retrieve the last sent tweet
            const lastTweet = postedTweets.length ? postedTweets[postedTweets.length - 1] : null;
            // Build the tweet query params
            const queryParams = { ...(typeof tweet === 'string' ? ({ status: tweet }) : tweet) };
            // Reply to an existing tweet if needed
            const inReplyToId = lastTweet ? lastTweet.id_str : queryParams.in_reply_to_status_id;
            const status = queryParams.status;
            if (inReplyToId) {
                postedTweets.push(await this.reply(status, inReplyToId, queryParams));
            }
            else {
                postedTweets.push(await this.tweet(status, queryParams));
            }
        }
        return postedTweets;
    }
    /**
     * Reply to an existing tweet. Shortcut to `.tweet` with tweaked parameters.
     * https://developer.twitter.com/en/docs/twitter-api/v1/tweets/post-and-engage/api-reference/post-statuses-update
     */
    reply(status, in_reply_to_status_id, payload = {}) {
        return this.tweet(status, {
            auto_populate_reply_metadata: true,
            in_reply_to_status_id,
            ...payload,
        });
    }
    /**
     * Delete an existing tweet belonging to you.
     * https://developer.twitter.com/en/docs/twitter-api/v1/tweets/post-and-engage/api-reference/post-statuses-destroy-id
     */
    deleteTweet(tweetId) {
        return this.post('statuses/destroy/:id.json', { tweet_mode: 'extended' }, { params: { id: tweetId } });
    }
    /* User API */
    /**
     * Report the specified user as a spam account to Twitter.
     * Additionally, optionally performs the equivalent of POST blocks/create on behalf of the authenticated user.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/mute-block-report-users/api-reference/post-users-report_spam
     */
    reportUserAsSpam(options) {
        return this.post('users/report_spam.json', { tweet_mode: 'extended', ...options });
    }
    /**
     * Turn on/off Retweets and device notifications from the specified user.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/post-friendships-update
     */
    updateFriendship(options) {
        return this.post('friendships/update.json', options);
    }
    /**
     * Follow the specified user.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/post-friendships-create
     */
    createFriendship(options) {
        return this.post('friendships/create.json', options);
    }
    /**
     * Unfollow the specified user.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/post-friendships-destroy
     */
    destroyFriendship(options) {
        return this.post('friendships/destroy.json', options);
    }
    /* Account API */
    /**
     * Update current account settings for authenticating user.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/manage-account-settings/api-reference/get-account-settings
     */
    updateAccountSettings(options) {
        return this.post('account/settings.json', options);
    }
    /**
     * Sets some values that users are able to set under the "Account" tab of their settings page.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/manage-account-settings/api-reference/post-account-update_profile
     */
    updateAccountProfile(options) {
        return this.post('account/update_profile.json', options);
    }
    /**
     * Uploads a profile banner on behalf of the authenticating user.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/manage-account-settings/api-reference/post-account-update_profile_banner
     */
    async updateAccountProfileBanner(file, options = {}) {
        const queryParams = {
            banner: await readFileIntoBuffer(file),
            ...options,
        };
        return this.post('account/update_profile_banner.json', queryParams, { forceBodyMode: 'form-data' });
    }
    /**
     * Updates the authenticating user's profile image.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/manage-account-settings/api-reference/post-account-update_profile_image
     */
    async updateAccountProfileImage(file, options = {}) {
        const queryParams = {
            tweet_mode: 'extended',
            image: await readFileIntoBuffer(file),
            ...options,
        };
        return this.post('account/update_profile_image.json', queryParams, { forceBodyMode: 'form-data' });
    }
    /**
     * Removes the uploaded profile banner for the authenticating user.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/manage-account-settings/api-reference/post-account-remove_profile_banner
     */
    removeAccountProfileBanner() {
        return this.post('account/remove_profile_banner.json');
    }
    /* Lists */
    /**
     * Creates a new list for the authenticated user.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/create-manage-lists/api-reference/post-lists-create
     */
    createList(options) {
        return this.post('lists/create.json', { tweet_mode: 'extended', ...options });
    }
    /**
     * Updates the specified list. The authenticated user must own the list to be able to update it.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/create-manage-lists/api-reference/post-lists-update
     */
    updateList(options) {
        return this.post('lists/update.json', { tweet_mode: 'extended', ...options });
    }
    /**
     * Deletes the specified list. The authenticated user must own the list to be able to destroy it.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/create-manage-lists/api-reference/post-lists-destroy
     */
    removeList(options) {
        return this.post('lists/destroy.json', { tweet_mode: 'extended', ...options });
    }
    /**
     * Adds multiple members to a list, by specifying a comma-separated list of member ids or screen names.
     * If you add a single `user_id` or `screen_name`, it will target `lists/members/create.json`, otherwise
     * it will target `lists/members/create_all.json`.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/create-manage-lists/api-reference/post-lists-members-create_all
     */
    addListMembers(options) {
        const hasMultiple = (options.user_id && hasMultipleItems(options.user_id)) || (options.screen_name && hasMultipleItems(options.screen_name));
        const endpoint = hasMultiple ? 'lists/members/create_all.json' : 'lists/members/create.json';
        return this.post(endpoint, options);
    }
    /**
     * Removes multiple members to a list, by specifying a comma-separated list of member ids or screen names.
     * If you add a single `user_id` or `screen_name`, it will target `lists/members/destroy.json`, otherwise
     * it will target `lists/members/destroy_all.json`.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/create-manage-lists/api-reference/post-lists-members-destroy_all
     */
    removeListMembers(options) {
        const hasMultiple = (options.user_id && hasMultipleItems(options.user_id)) || (options.screen_name && hasMultipleItems(options.screen_name));
        const endpoint = hasMultiple ? 'lists/members/destroy_all.json' : 'lists/members/destroy.json';
        return this.post(endpoint, options);
    }
    /**
     * Subscribes the authenticated user to the specified list.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/create-manage-lists/api-reference/post-lists-subscribers-create
     */
    subscribeToList(options) {
        return this.post('lists/subscribers/create.json', { tweet_mode: 'extended', ...options });
    }
    /**
     * Unsubscribes the authenticated user of the specified list.
     * https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/create-manage-lists/api-reference/post-lists-subscribers-destroy
     */
    unsubscribeOfList(options) {
        return this.post('lists/subscribers/destroy.json', { tweet_mode: 'extended', ...options });
    }
    /* Media upload API */
    /**
     * This endpoint can be used to provide additional information about the uploaded media_id.
     * This feature is currently only supported for images and GIFs.
     * https://developer.twitter.com/en/docs/twitter-api/v1/media/upload-media/api-reference/post-media-metadata-create
     */
    createMediaMetadata(mediaId, metadata) {
        return this.post('media/metadata/create.json', { media_id: mediaId, ...metadata }, { prefix: API_V1_1_UPLOAD_PREFIX, forceBodyMode: 'json' });
    }
    /**
     * Use this endpoint to associate uploaded subtitles to an uploaded video. You can associate subtitles to video before or after Tweeting.
     * **To obtain subtitle media ID, you must upload each subtitle file separately using `.uploadMedia()` method.**
     *
     * https://developer.twitter.com/en/docs/twitter-api/v1/media/upload-media/api-reference/post-media-subtitles-create
     */
    createMediaSubtitles(mediaId, subtitles) {
        return this.post('media/subtitles/create.json', { media_id: mediaId, media_category: 'TweetVideo', subtitle_info: { subtitles } }, { prefix: API_V1_1_UPLOAD_PREFIX, forceBodyMode: 'json' });
    }
    /**
     * Use this endpoint to dissociate subtitles from a video and delete the subtitles. You can dissociate subtitles from a video before or after Tweeting.
     * https://developer.twitter.com/en/docs/twitter-api/v1/media/upload-media/api-reference/post-media-subtitles-delete
     */
    deleteMediaSubtitles(mediaId, ...languages) {
        return this.post('media/subtitles/delete.json', {
            media_id: mediaId,
            media_category: 'TweetVideo',
            subtitle_info: { subtitles: languages.map(lang => ({ language_code: lang })) },
        }, { prefix: API_V1_1_UPLOAD_PREFIX, forceBodyMode: 'json' });
    }
    /**
     * Upload a media (JPG/PNG/GIF/MP4/MOV/WEBP) or subtitle (SRT) to Twitter and return the media_id to use in tweet/DM send.
     *
     * @param file If `string`, filename is supposed.
     * A `Buffer` is a raw file.
     * `fs.promises.FileHandle` or `number` are file pointers.
     *
     * @param options.type File type (Enum 'jpg' | 'longmp4' | 'mp4' | 'mov | 'png' | 'gif' | 'srt' | 'webp').
     * If filename is given, it could be guessed with file extension, otherwise this parameter is mandatory.
     * If type is not part of the enum, it will be used as mime type.
     *
     * Type `longmp4` is **required** is you try to upload a video higher than 140 seconds.
     *
     * @param options.chunkLength Maximum chunk length sent to Twitter. Default goes to 1 MB.
     *
     * @param options.additionalOwners Other user IDs allowed to use the returned media_id. Default goes to none.
     *
     * @param options.maxConcurrentUploads Maximum uploaded chunks in the same time. Default goes to 3.
     *
     * @param options.target Target type `tweet` or `dm`. Defaults to `tweet`.
     * You must specify it if you send a media to use in DMs.
     */
    async uploadMedia(file, options = {}) {
        var _a;
        const chunkLength = (_a = options.chunkLength) !== null && _a !== void 0 ? _a : (1024 * 1024);
        const { fileHandle, mediaCategory, fileSize, mimeType } = await this.getUploadMediaRequirements(file, options);
        // Get the file handle (if not buffer)
        try {
            // Finally! We can send INIT message.
            const mediaData = await this.post(UPLOAD_ENDPOINT, {
                command: 'INIT',
                total_bytes: fileSize,
                media_type: mimeType,
                media_category: mediaCategory,
                additional_owners: options.additionalOwners,
                shared: options.shared ? true : undefined,
            }, { prefix: API_V1_1_UPLOAD_PREFIX });
            // Upload the media chunk by chunk
            await this.mediaChunkedUpload(fileHandle, chunkLength, mediaData.media_id_string, options.maxConcurrentUploads);
            // Finalize media
            const fullMediaData = await this.post(UPLOAD_ENDPOINT, {
                command: 'FINALIZE',
                media_id: mediaData.media_id_string,
            }, { prefix: API_V1_1_UPLOAD_PREFIX });
            if (fullMediaData.processing_info && fullMediaData.processing_info.state !== 'succeeded') {
                // Must wait if video is still computed
                await this.awaitForMediaProcessingCompletion(fullMediaData);
            }
            // Video is ready, return media_id
            return fullMediaData.media_id_string;
        }
        finally {
            // Close file if any
            if (typeof file === 'number') {
                // eslint-disable-next-line @typescript-eslint/no-empty-function
                fs__namespace.close(file, () => { });
            }
            else if (typeof fileHandle === 'object' && !(fileHandle instanceof Buffer)) {
                fileHandle.close();
            }
        }
    }
    async awaitForMediaProcessingCompletion(fullMediaData) {
        var _a;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            fullMediaData = await this.mediaInfo(fullMediaData.media_id_string);
            const { processing_info } = fullMediaData;
            if (!processing_info || processing_info.state === 'succeeded') {
                // Ok, completed!
                return;
            }
            if ((_a = processing_info.error) === null || _a === void 0 ? void 0 : _a.code) {
                const { name, message } = processing_info.error;
                throw new Error(`Failed to process media: ${name} - ${message}.`);
            }
            if (processing_info.state === 'failed') {
                // No error data
                throw new Error('Failed to process the media.');
            }
            if (processing_info.check_after_secs) {
                // Await for given seconds
                await sleepSecs(processing_info.check_after_secs);
            }
            else {
                // No info; Await for 5 seconds
                await sleepSecs(5);
            }
        }
    }
    async getUploadMediaRequirements(file, { mimeType, type, target, longVideo } = {}) {
        // Get the file handle (if not buffer)
        let fileHandle;
        try {
            fileHandle = await getFileHandle(file);
            // Get the mimetype
            const realMimeType = getMimeType(file, type, mimeType);
            // Get the media category
            let mediaCategory;
            // If explicit longmp4 OR explicit MIME type and not DM target
            if (realMimeType === EUploadMimeType.Mp4 && ((!mimeType && !type && target !== 'dm') || longVideo)) {
                mediaCategory = 'amplify_video';
            }
            else {
                mediaCategory = getMediaCategoryByMime(realMimeType, target !== null && target !== void 0 ? target : 'tweet');
            }
            return {
                fileHandle,
                mediaCategory,
                fileSize: await getFileSizeFromFileHandle(fileHandle),
                mimeType: realMimeType,
            };
        }
        catch (e) {
            // Close file if any
            if (typeof file === 'number') {
                // eslint-disable-next-line @typescript-eslint/no-empty-function
                fs__namespace.close(file, () => { });
            }
            else if (typeof fileHandle === 'object' && !(fileHandle instanceof Buffer)) {
                fileHandle.close();
            }
            throw e;
        }
    }
    async mediaChunkedUpload(fileHandle, chunkLength, mediaId, maxConcurrentUploads = 3) {
        // Send chunk by chunk
        let chunkIndex = 0;
        if (maxConcurrentUploads < 1) {
            throw new RangeError('Bad maxConcurrentUploads parameter.');
        }
        // Creating a buffer for doing file stuff (if we don't have one)
        const buffer = fileHandle instanceof Buffer ? undefined : Buffer.alloc(chunkLength);
        // Sliced/filled buffer returned for each part
        let readBuffer;
        // Needed to know when we should stop reading the file
        let nread;
        // Needed to use the buffer object (file handles always "remembers" file position)
        let offset = 0;
        [readBuffer, nread] = await readNextPartOf(fileHandle, chunkLength, offset, buffer);
        offset += nread;
        // Handle max concurrent uploads
        const currentUploads = new Set();
        // Read buffer until file is completely read
        while (nread) {
            const mediaBufferPart = readBuffer.slice(0, nread);
            // Sent part if part has something inside
            if (mediaBufferPart.length) {
                const request = this.post(UPLOAD_ENDPOINT, {
                    command: 'APPEND',
                    media_id: mediaId,
                    segment_index: chunkIndex,
                    media: mediaBufferPart,
                }, { prefix: API_V1_1_UPLOAD_PREFIX });
                currentUploads.add(request);
                request.then(() => {
                    currentUploads.delete(request);
                });
                chunkIndex++;
            }
            if (currentUploads.size >= maxConcurrentUploads) {
                // Await for first promise to be finished
                await Promise.race(currentUploads);
            }
            [readBuffer, nread] = await readNextPartOf(fileHandle, chunkLength, offset, buffer);
            offset += nread;
        }
        await Promise.all([...currentUploads]);
    }
}

/**
 * Twitter v1.1 API client with read/write/DMs rights.
 */
class TwitterApiv1 extends TwitterApiv1ReadWrite {
    constructor() {
        super(...arguments);
        this._prefix = API_V1_1_PREFIX;
    }
    /**
     * Get a client with read/write rights.
     */
    get readWrite() {
        return this;
    }
    /* Direct messages */
    // Part: Sending and receiving events
    /**
     * Publishes a new message_create event resulting in a Direct Message sent to a specified user from the authenticating user.
     * https://developer.twitter.com/en/docs/twitter-api/v1/direct-messages/sending-and-receiving/api-reference/new-event
     */
    sendDm({ recipient_id, custom_profile_id, ...params }) {
        const args = {
            event: {
                type: EDirectMessageEventTypeV1.Create,
                [EDirectMessageEventTypeV1.Create]: {
                    target: { recipient_id },
                    message_data: params,
                },
            },
        };
        if (custom_profile_id) {
            args.event[EDirectMessageEventTypeV1.Create].custom_profile_id = custom_profile_id;
        }
        return this.post('direct_messages/events/new.json', args, {
            forceBodyMode: 'json',
        });
    }
    /**
     * Returns a single Direct Message event by the given id.
     *
     * https://developer.twitter.com/en/docs/twitter-api/v1/direct-messages/sending-and-receiving/api-reference/get-event
     */
    getDmEvent(id) {
        return this.get('direct_messages/events/show.json', { id });
    }
    /**
     * Deletes the direct message specified in the required ID parameter.
     * The authenticating user must be the recipient of the specified direct message.
     * https://developer.twitter.com/en/docs/twitter-api/v1/direct-messages/sending-and-receiving/api-reference/delete-message-event
     */
    deleteDm(id) {
        return this.delete('direct_messages/events/destroy.json', { id });
    }
    /**
     * Returns all Direct Message events (both sent and received) within the last 30 days.
     * Sorted in reverse-chronological order.
     *
     * https://developer.twitter.com/en/docs/twitter-api/v1/direct-messages/sending-and-receiving/api-reference/list-events
     */
    async listDmEvents(args = {}) {
        const queryParams = { ...args };
        const initialRq = await this.get('direct_messages/events/list.json', queryParams, { fullResponse: true });
        return new DmEventsV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    // Part: Welcome messages (events)
    /**
     * Creates a new Welcome Message that will be stored and sent in the future from the authenticating user in defined circumstances.
     * https://developer.twitter.com/en/docs/twitter-api/v1/direct-messages/welcome-messages/api-reference/new-welcome-message
     */
    newWelcomeDm(name, data) {
        const args = {
            [EDirectMessageEventTypeV1.WelcomeCreate]: {
                name,
                message_data: data,
            },
        };
        return this.post('direct_messages/welcome_messages/new.json', args, {
            forceBodyMode: 'json',
        });
    }
    /**
     * Returns a Welcome Message by the given id.
     * https://developer.twitter.com/en/docs/twitter-api/v1/direct-messages/welcome-messages/api-reference/get-welcome-message
     */
    getWelcomeDm(id) {
        return this.get('direct_messages/welcome_messages/show.json', { id });
    }
    /**
     * Deletes a Welcome Message by the given id.
     * https://developer.twitter.com/en/docs/twitter-api/v1/direct-messages/welcome-messages/api-reference/delete-welcome-message
     */
    deleteWelcomeDm(id) {
        return this.delete('direct_messages/welcome_messages/destroy.json', { id });
    }
    /**
     * Updates a Welcome Message by the given ID.
     * Updates to the welcome_message object are atomic.
     * https://developer.twitter.com/en/docs/twitter-api/v1/direct-messages/welcome-messages/api-reference/update-welcome-message
     */
    updateWelcomeDm(id, data) {
        const args = { message_data: data };
        return this.put('direct_messages/welcome_messages/update.json', args, {
            forceBodyMode: 'json',
            query: { id },
        });
    }
    /**
     * Returns all Direct Message events (both sent and received) within the last 30 days.
     * Sorted in reverse-chronological order.
     *
     * https://developer.twitter.com/en/docs/twitter-api/v1/direct-messages/sending-and-receiving/api-reference/list-events
     */
    async listWelcomeDms(args = {}) {
        const queryParams = { ...args };
        const initialRq = await this.get('direct_messages/welcome_messages/list.json', queryParams, { fullResponse: true });
        return new WelcomeDmV1Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    // Part: Welcome message (rules)
    /**
     * Creates a new Welcome Message Rule that determines which Welcome Message will be shown in a given conversation.
     * https://developer.twitter.com/en/docs/twitter-api/v1/direct-messages/welcome-messages/api-reference/new-welcome-message-rule
     */
    newWelcomeDmRule(welcomeMessageId) {
        return this.post('direct_messages/welcome_messages/rules/new.json', {
            welcome_message_rule: { welcome_message_id: welcomeMessageId },
        }, {
            forceBodyMode: 'json',
        });
    }
    /**
     * Returns a Welcome Message Rule by the given id.
     * https://developer.twitter.com/en/docs/twitter-api/v1/direct-messages/welcome-messages/api-reference/get-welcome-message-rule
     */
    getWelcomeDmRule(id) {
        return this.get('direct_messages/welcome_messages/rules/show.json', { id });
    }
    /**
     * Deletes a Welcome Message Rule by the given id.
     * https://developer.twitter.com/en/docs/twitter-api/v1/direct-messages/welcome-messages/api-reference/delete-welcome-message-rule
     */
    deleteWelcomeDmRule(id) {
        return this.delete('direct_messages/welcome_messages/rules/destroy.json', { id });
    }
    /**
     * Retrieves all welcome DM rules for this account.
     * https://developer.twitter.com/en/docs/twitter-api/v1/direct-messages/welcome-messages/api-reference/list-welcome-message-rules
     */
    async listWelcomeDmRules(args = {}) {
        const queryParams = { ...args };
        return this.get('direct_messages/welcome_messages/rules/list.json', queryParams);
    }
    /**
     * Set the current showed welcome message for logged account ; wrapper for Welcome DM rules.
     * Test if a rule already exists, delete if any, then create a rule for current message ID.
     *
     * If you don't have already a welcome message, create it with `.newWelcomeMessage`.
     */
    async setWelcomeDm(welcomeMessageId, deleteAssociatedWelcomeDmWhenDeletingRule = true) {
        var _a;
        const existingRules = await this.listWelcomeDmRules();
        if ((_a = existingRules.welcome_message_rules) === null || _a === void 0 ? void 0 : _a.length) {
            for (const rule of existingRules.welcome_message_rules) {
                await this.deleteWelcomeDmRule(rule.id);
                if (deleteAssociatedWelcomeDmWhenDeletingRule) {
                    await this.deleteWelcomeDm(rule.welcome_message_id);
                }
            }
        }
        return this.newWelcomeDmRule(welcomeMessageId);
    }
    // Part: Read indicator
    /**
     * Marks a message as read in the recipient’s Direct Message conversation view with the sender.
     * https://developer.twitter.com/en/docs/twitter-api/v1/direct-messages/typing-indicator-and-read-receipts/api-reference/new-read-receipt
     */
    markDmAsRead(lastEventId, recipientId) {
        return this.post('direct_messages/mark_read.json', {
            last_read_event_id: lastEventId,
            recipient_id: recipientId,
        }, { forceBodyMode: 'url' });
    }
    /**
     * Displays a visual typing indicator in the recipient’s Direct Message conversation view with the sender.
     * https://developer.twitter.com/en/docs/twitter-api/v1/direct-messages/typing-indicator-and-read-receipts/api-reference/new-typing-indicator
     */
    indicateDmTyping(recipientId) {
        return this.post('direct_messages/indicate_typing.json', {
            recipient_id: recipientId,
        }, { forceBodyMode: 'url' });
    }
    // Part: Images
    /**
     * Get a single image attached to a direct message. TwitterApi client must be logged with OAuth 1.0a.
     * https://developer.twitter.com/en/docs/twitter-api/v1/direct-messages/message-attachments/guides/retrieving-media
     */
    async downloadDmImage(urlOrDm) {
        if (typeof urlOrDm !== 'string') {
            const attachment = urlOrDm[EDirectMessageEventTypeV1.Create].message_data.attachment;
            if (!attachment) {
                throw new Error('The given direct message doesn\'t contain any attachment');
            }
            urlOrDm = attachment.media.media_url_https;
        }
        const data = await this.get(urlOrDm, undefined, { forceParseMode: 'buffer', prefix: '' });
        if (!data.length) {
            throw new Error('Image not found. Make sure you are logged with credentials able to access direct messages, and check the URL.');
        }
        return data;
    }
}

/**
 * Provide helpers for `.includes` of a v2 API result.
 * Needed expansions for a method to work are specified (*`like this`*).
 */
class TwitterV2IncludesHelper {
    constructor(result) {
        this.result = result;
    }
    /* Tweets */
    get tweets() {
        return TwitterV2IncludesHelper.tweets(this.result);
    }
    static tweets(result) {
        var _a, _b;
        return (_b = (_a = result.includes) === null || _a === void 0 ? void 0 : _a.tweets) !== null && _b !== void 0 ? _b : [];
    }
    tweetById(id) {
        return TwitterV2IncludesHelper.tweetById(this.result, id);
    }
    static tweetById(result, id) {
        return this.tweets(result).find(tweet => tweet.id === id);
    }
    /** Retweet associated with the given tweet (*`referenced_tweets.id`*) */
    retweet(tweet) {
        return TwitterV2IncludesHelper.retweet(this.result, tweet);
    }
    /** Retweet associated with the given tweet (*`referenced_tweets.id`*) */
    static retweet(result, tweet) {
        var _a;
        const retweetIds = ((_a = tweet.referenced_tweets) !== null && _a !== void 0 ? _a : [])
            .filter(ref => ref.type === 'retweeted')
            .map(ref => ref.id);
        return this.tweets(result).find(t => retweetIds.includes(t.id));
    }
    /** Quoted tweet associated with the given tweet (*`referenced_tweets.id`*) */
    quote(tweet) {
        return TwitterV2IncludesHelper.quote(this.result, tweet);
    }
    /** Quoted tweet associated with the given tweet (*`referenced_tweets.id`*) */
    static quote(result, tweet) {
        var _a;
        const quoteIds = ((_a = tweet.referenced_tweets) !== null && _a !== void 0 ? _a : [])
            .filter(ref => ref.type === 'quoted')
            .map(ref => ref.id);
        return this.tweets(result).find(t => quoteIds.includes(t.id));
    }
    /** Tweet whose has been answered by the given tweet (*`referenced_tweets.id`*) */
    repliedTo(tweet) {
        return TwitterV2IncludesHelper.repliedTo(this.result, tweet);
    }
    /** Tweet whose has been answered by the given tweet (*`referenced_tweets.id`*) */
    static repliedTo(result, tweet) {
        var _a;
        const repliesIds = ((_a = tweet.referenced_tweets) !== null && _a !== void 0 ? _a : [])
            .filter(ref => ref.type === 'replied_to')
            .map(ref => ref.id);
        return this.tweets(result).find(t => repliesIds.includes(t.id));
    }
    /** Tweet author user object of the given tweet (*`author_id`* or *`referenced_tweets.id.author_id`*) */
    author(tweet) {
        return TwitterV2IncludesHelper.author(this.result, tweet);
    }
    /** Tweet author user object of the given tweet (*`author_id`* or *`referenced_tweets.id.author_id`*) */
    static author(result, tweet) {
        const authorId = tweet.author_id;
        return authorId ? this.users(result).find(u => u.id === authorId) : undefined;
    }
    /** Tweet author user object of the tweet answered by the given tweet (*`in_reply_to_user_id`*) */
    repliedToAuthor(tweet) {
        return TwitterV2IncludesHelper.repliedToAuthor(this.result, tweet);
    }
    /** Tweet author user object of the tweet answered by the given tweet (*`in_reply_to_user_id`*) */
    static repliedToAuthor(result, tweet) {
        const inReplyUserId = tweet.in_reply_to_user_id;
        return inReplyUserId ? this.users(result).find(u => u.id === inReplyUserId) : undefined;
    }
    /* Users */
    get users() {
        return TwitterV2IncludesHelper.users(this.result);
    }
    static users(result) {
        var _a, _b;
        return (_b = (_a = result.includes) === null || _a === void 0 ? void 0 : _a.users) !== null && _b !== void 0 ? _b : [];
    }
    userById(id) {
        return TwitterV2IncludesHelper.userById(this.result, id);
    }
    static userById(result, id) {
        return this.users(result).find(u => u.id === id);
    }
    /** Pinned tweet of the given user (*`pinned_tweet_id`*) */
    pinnedTweet(user) {
        return TwitterV2IncludesHelper.pinnedTweet(this.result, user);
    }
    /** Pinned tweet of the given user (*`pinned_tweet_id`*) */
    static pinnedTweet(result, user) {
        return user.pinned_tweet_id ? this.tweets(result).find(t => t.id === user.pinned_tweet_id) : undefined;
    }
    /* Medias */
    get media() {
        return TwitterV2IncludesHelper.media(this.result);
    }
    static media(result) {
        var _a, _b;
        return (_b = (_a = result.includes) === null || _a === void 0 ? void 0 : _a.media) !== null && _b !== void 0 ? _b : [];
    }
    /** Medias associated with the given tweet (*`attachments.media_keys`*) */
    medias(tweet) {
        return TwitterV2IncludesHelper.medias(this.result, tweet);
    }
    /** Medias associated with the given tweet (*`attachments.media_keys`*) */
    static medias(result, tweet) {
        var _a, _b;
        const keys = (_b = (_a = tweet.attachments) === null || _a === void 0 ? void 0 : _a.media_keys) !== null && _b !== void 0 ? _b : [];
        return this.media(result).filter(m => keys.includes(m.media_key));
    }
    /* Polls */
    get polls() {
        return TwitterV2IncludesHelper.polls(this.result);
    }
    static polls(result) {
        var _a, _b;
        return (_b = (_a = result.includes) === null || _a === void 0 ? void 0 : _a.polls) !== null && _b !== void 0 ? _b : [];
    }
    /** Poll associated with the given tweet (*`attachments.poll_ids`*) */
    poll(tweet) {
        return TwitterV2IncludesHelper.poll(this.result, tweet);
    }
    /** Poll associated with the given tweet (*`attachments.poll_ids`*) */
    static poll(result, tweet) {
        var _a, _b;
        const pollIds = (_b = (_a = tweet.attachments) === null || _a === void 0 ? void 0 : _a.poll_ids) !== null && _b !== void 0 ? _b : [];
        if (pollIds.length) {
            const pollId = pollIds[0];
            return this.polls(result).find(p => p.id === pollId);
        }
        return undefined;
    }
    /* Places */
    get places() {
        return TwitterV2IncludesHelper.places(this.result);
    }
    static places(result) {
        var _a, _b;
        return (_b = (_a = result.includes) === null || _a === void 0 ? void 0 : _a.places) !== null && _b !== void 0 ? _b : [];
    }
    /** Place associated with the given tweet (*`geo.place_id`*) */
    place(tweet) {
        return TwitterV2IncludesHelper.place(this.result, tweet);
    }
    /** Place associated with the given tweet (*`geo.place_id`*) */
    static place(result, tweet) {
        var _a;
        const placeId = (_a = tweet.geo) === null || _a === void 0 ? void 0 : _a.place_id;
        return placeId ? this.places(result).find(p => p.id === placeId) : undefined;
    }
    /* Lists */
    /** List owner of the given list (*`owner_id`*) */
    listOwner(list) {
        return TwitterV2IncludesHelper.listOwner(this.result, list);
    }
    /** List owner of the given list (*`owner_id`*) */
    static listOwner(result, list) {
        const creatorId = list.owner_id;
        return creatorId ? this.users(result).find(p => p.id === creatorId) : undefined;
    }
    /* Spaces */
    /** Creator of the given space (*`creator_id`*) */
    spaceCreator(space) {
        return TwitterV2IncludesHelper.spaceCreator(this.result, space);
    }
    /** Creator of the given space (*`creator_id`*) */
    static spaceCreator(result, space) {
        const creatorId = space.creator_id;
        return creatorId ? this.users(result).find(p => p.id === creatorId) : undefined;
    }
    /** Current hosts of the given space (*`host_ids`*) */
    spaceHosts(space) {
        return TwitterV2IncludesHelper.spaceHosts(this.result, space);
    }
    /** Current hosts of the given space (*`host_ids`*) */
    static spaceHosts(result, space) {
        var _a;
        const hostIds = (_a = space.host_ids) !== null && _a !== void 0 ? _a : [];
        return this.users(result).filter(u => hostIds.includes(u.id));
    }
    /** Current speakers of the given space (*`speaker_ids`*) */
    spaceSpeakers(space) {
        return TwitterV2IncludesHelper.spaceSpeakers(this.result, space);
    }
    /** Current speakers of the given space (*`speaker_ids`*) */
    static spaceSpeakers(result, space) {
        var _a;
        const speakerIds = (_a = space.speaker_ids) !== null && _a !== void 0 ? _a : [];
        return this.users(result).filter(u => speakerIds.includes(u.id));
    }
    /** Current invited users of the given space (*`invited_user_ids`*) */
    spaceInvitedUsers(space) {
        return TwitterV2IncludesHelper.spaceInvitedUsers(this.result, space);
    }
    /** Current invited users of the given space (*`invited_user_ids`*) */
    static spaceInvitedUsers(result, space) {
        var _a;
        const invitedUserIds = (_a = space.invited_user_ids) !== null && _a !== void 0 ? _a : [];
        return this.users(result).filter(u => invitedUserIds.includes(u.id));
    }
}

/** A generic PreviousableTwitterPaginator with common v2 helper methods. */
class TwitterV2Paginator extends PreviousableTwitterPaginator {
    updateIncludes(data) {
        // Update errors
        if (data.errors) {
            if (!this._realData.errors) {
                this._realData.errors = [];
            }
            this._realData.errors = [...this._realData.errors, ...data.errors];
        }
        // Update includes
        if (!data.includes) {
            return;
        }
        if (!this._realData.includes) {
            this._realData.includes = {};
        }
        const includesRealData = this._realData.includes;
        for (const [includeKey, includeArray] of Object.entries(data.includes)) {
            if (!includesRealData[includeKey]) {
                includesRealData[includeKey] = [];
            }
            includesRealData[includeKey] = [
                ...includesRealData[includeKey],
                ...includeArray,
            ];
        }
    }
    /** Throw if the current paginator is not usable. */
    assertUsable() {
        if (this.unusable) {
            throw new Error('Unable to use this paginator to fetch more data, as it does not contain any metadata.' +
                ' Check .errors property for more details.');
        }
    }
    get meta() {
        return this._realData.meta;
    }
    get includes() {
        var _a;
        if (!((_a = this._realData) === null || _a === void 0 ? void 0 : _a.includes)) {
            return new TwitterV2IncludesHelper(this._realData);
        }
        if (this._includesInstance) {
            return this._includesInstance;
        }
        return this._includesInstance = new TwitterV2IncludesHelper(this._realData);
    }
    get errors() {
        var _a;
        return (_a = this._realData.errors) !== null && _a !== void 0 ? _a : [];
    }
    /** `true` if this paginator only contains error payload and no metadata found to consume data. */
    get unusable() {
        return this.errors.length > 0 && !this._realData.meta && !this._realData.data;
    }
}
/** A generic TwitterV2Paginator able to consume v2 timelines that use max_results and pagination tokens. */
class TimelineV2Paginator extends TwitterV2Paginator {
    refreshInstanceFromResult(response, isNextPage) {
        var _a;
        const result = response.data;
        const resultData = (_a = result.data) !== null && _a !== void 0 ? _a : [];
        this._rateLimit = response.rateLimit;
        if (!this._realData.data) {
            this._realData.data = [];
        }
        if (isNextPage) {
            this._realData.meta.result_count += result.meta.result_count;
            this._realData.meta.next_token = result.meta.next_token;
            this._realData.data.push(...resultData);
        }
        else {
            this._realData.meta.result_count += result.meta.result_count;
            this._realData.meta.previous_token = result.meta.previous_token;
            this._realData.data.unshift(...resultData);
        }
        this.updateIncludes(result);
    }
    getNextQueryParams(maxResults) {
        this.assertUsable();
        return {
            ...this.injectQueryParams(maxResults),
            pagination_token: this._realData.meta.next_token,
        };
    }
    getPreviousQueryParams(maxResults) {
        this.assertUsable();
        return {
            ...this.injectQueryParams(maxResults),
            pagination_token: this._realData.meta.previous_token,
        };
    }
    getPageLengthFromRequest(result) {
        var _a, _b;
        return (_b = (_a = result.data.data) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0;
    }
    isFetchLastOver(result) {
        var _a;
        return !((_a = result.data.data) === null || _a === void 0 ? void 0 : _a.length) || !this.canFetchNextPage(result.data);
    }
    canFetchNextPage(result) {
        var _a;
        return !!((_a = result.meta) === null || _a === void 0 ? void 0 : _a.next_token);
    }
}

/** A generic PreviousableTwitterPaginator able to consume TweetV2 timelines with since_id, until_id and next_token (when available). */
class TweetTimelineV2Paginator extends TwitterV2Paginator {
    refreshInstanceFromResult(response, isNextPage) {
        var _a;
        const result = response.data;
        const resultData = (_a = result.data) !== null && _a !== void 0 ? _a : [];
        this._rateLimit = response.rateLimit;
        if (!this._realData.data) {
            this._realData.data = [];
        }
        if (isNextPage) {
            this._realData.meta.oldest_id = result.meta.oldest_id;
            this._realData.meta.result_count += result.meta.result_count;
            this._realData.meta.next_token = result.meta.next_token;
            this._realData.data.push(...resultData);
        }
        else {
            this._realData.meta.newest_id = result.meta.newest_id;
            this._realData.meta.result_count += result.meta.result_count;
            this._realData.data.unshift(...resultData);
        }
        this.updateIncludes(result);
    }
    getNextQueryParams(maxResults) {
        this.assertUsable();
        const params = { ...this.injectQueryParams(maxResults) };
        if (this._realData.meta.next_token) {
            params.next_token = this._realData.meta.next_token;
        }
        else {
            if (params.start_time) {
                // until_id and start_time are forbidden together for some reason, so convert start_time to a since_id.
                params.since_id = this.dateStringToSnowflakeId(params.start_time);
                delete params.start_time;
            }
            if (params.end_time) {
                // until_id overrides end_time, so delete it
                delete params.end_time;
            }
            params.until_id = this._realData.meta.oldest_id;
        }
        return params;
    }
    getPreviousQueryParams(maxResults) {
        this.assertUsable();
        return {
            ...this.injectQueryParams(maxResults),
            since_id: this._realData.meta.newest_id,
        };
    }
    getPageLengthFromRequest(result) {
        var _a, _b;
        return (_b = (_a = result.data.data) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0;
    }
    isFetchLastOver(result) {
        var _a;
        return !((_a = result.data.data) === null || _a === void 0 ? void 0 : _a.length) || !this.canFetchNextPage(result.data);
    }
    canFetchNextPage(result) {
        return !!result.meta.next_token;
    }
    getItemArray() {
        return this.tweets;
    }
    dateStringToSnowflakeId(dateStr) {
        const TWITTER_START_EPOCH = BigInt('1288834974657');
        const date = new Date(dateStr);
        if (isNaN(date.valueOf())) {
            throw new Error('Unable to convert start_time/end_time to a valid date. A ISO 8601 DateTime is excepted, please check your input.');
        }
        const dateTimestamp = BigInt(date.valueOf());
        return ((dateTimestamp - TWITTER_START_EPOCH) << BigInt('22')).toString();
    }
    /**
     * Tweets returned by paginator.
     */
    get tweets() {
        var _a;
        return (_a = this._realData.data) !== null && _a !== void 0 ? _a : [];
    }
    get meta() {
        return super.meta;
    }
}
/** A generic PreviousableTwitterPaginator able to consume TweetV2 timelines with pagination_tokens. */
class TweetPaginableTimelineV2Paginator extends TimelineV2Paginator {
    refreshInstanceFromResult(response, isNextPage) {
        super.refreshInstanceFromResult(response, isNextPage);
        const result = response.data;
        if (isNextPage) {
            this._realData.meta.oldest_id = result.meta.oldest_id;
        }
        else {
            this._realData.meta.newest_id = result.meta.newest_id;
        }
    }
    getItemArray() {
        return this.tweets;
    }
    /**
     * Tweets returned by paginator.
     */
    get tweets() {
        var _a;
        return (_a = this._realData.data) !== null && _a !== void 0 ? _a : [];
    }
    get meta() {
        return super.meta;
    }
}
// ----------------
// - Tweet search -
// ----------------
class TweetSearchRecentV2Paginator extends TweetTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'tweets/search/recent';
    }
}
class TweetSearchAllV2Paginator extends TweetTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'tweets/search/all';
    }
}
class QuotedTweetsTimelineV2Paginator extends TweetPaginableTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'tweets/:id/quote_tweets';
    }
}
// -----------------
// - Home timeline -
// -----------------
class TweetHomeTimelineV2Paginator extends TweetPaginableTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'users/:id/timelines/reverse_chronological';
    }
}
class TweetUserTimelineV2Paginator extends TweetPaginableTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'users/:id/tweets';
    }
}
class TweetUserMentionTimelineV2Paginator extends TweetPaginableTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'users/:id/mentions';
    }
}
// -------------
// - Bookmarks -
// -------------
class TweetBookmarksTimelineV2Paginator extends TweetPaginableTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'users/:id/bookmarks';
    }
}
// ---------------------------------------------------------------------------------
// - Tweet lists (consume tweets with pagination tokens instead of since/until id) -
// ---------------------------------------------------------------------------------
/** A generic TwitterPaginator able to consume TweetV2 timelines. */
class TweetListV2Paginator extends TimelineV2Paginator {
    /**
     * Tweets returned by paginator.
     */
    get tweets() {
        var _a;
        return (_a = this._realData.data) !== null && _a !== void 0 ? _a : [];
    }
    get meta() {
        return super.meta;
    }
    getItemArray() {
        return this.tweets;
    }
}
class TweetV2UserLikedTweetsPaginator extends TweetListV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'users/:id/liked_tweets';
    }
}
class TweetV2ListTweetsPaginator extends TweetListV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'lists/:id/tweets';
    }
}

/** A generic PreviousableTwitterPaginator able to consume UserV2 timelines. */
class UserTimelineV2Paginator extends TimelineV2Paginator {
    getItemArray() {
        return this.users;
    }
    /**
     * Users returned by paginator.
     */
    get users() {
        var _a;
        return (_a = this._realData.data) !== null && _a !== void 0 ? _a : [];
    }
    get meta() {
        return super.meta;
    }
}
class UserBlockingUsersV2Paginator extends UserTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'users/:id/blocking';
    }
}
class UserMutingUsersV2Paginator extends UserTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'users/:id/muting';
    }
}
class UserFollowersV2Paginator extends UserTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'users/:id/followers';
    }
}
class UserFollowingV2Paginator extends UserTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'users/:id/following';
    }
}
class UserListMembersV2Paginator extends UserTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'lists/:id/members';
    }
}
class UserListFollowersV2Paginator extends UserTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'lists/:id/followers';
    }
}
class TweetLikingUsersV2Paginator extends UserTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'tweets/:id/liking_users';
    }
}
class TweetRetweetersUsersV2Paginator extends UserTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'tweets/:id/retweeted_by';
    }
}

class ListTimelineV2Paginator extends TimelineV2Paginator {
    getItemArray() {
        return this.lists;
    }
    /**
     * Lists returned by paginator.
     */
    get lists() {
        var _a;
        return (_a = this._realData.data) !== null && _a !== void 0 ? _a : [];
    }
    get meta() {
        return super.meta;
    }
}
class UserOwnedListsV2Paginator extends ListTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'users/:id/owned_lists';
    }
}
class UserListMembershipsV2Paginator extends ListTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'users/:id/list_memberships';
    }
}
class UserListFollowedV2Paginator extends ListTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'users/:id/followed_lists';
    }
}

/**
 * Base Twitter v2 labs client with only read right.
 */
class TwitterApiv2LabsReadOnly extends TwitterApiSubClient {
    constructor() {
        super(...arguments);
        this._prefix = API_V2_LABS_PREFIX;
    }
}

class DMTimelineV2Paginator extends TimelineV2Paginator {
    getItemArray() {
        return this.events;
    }
    /**
     * Events returned by paginator.
     */
    get events() {
        var _a;
        return (_a = this._realData.data) !== null && _a !== void 0 ? _a : [];
    }
    get meta() {
        return super.meta;
    }
}
class FullDMTimelineV2Paginator extends DMTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'dm_events';
    }
}
class OneToOneDMTimelineV2Paginator extends DMTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'dm_conversations/with/:participant_id/dm_events';
    }
}
class ConversationDMTimelineV2Paginator extends DMTimelineV2Paginator {
    constructor() {
        super(...arguments);
        this._endpoint = 'dm_conversations/:dm_conversation_id/dm_events';
    }
}

/**
 * Base Twitter v2 client with only read right.
 */
class TwitterApiv2ReadOnly extends TwitterApiSubClient {
    constructor() {
        super(...arguments);
        this._prefix = API_V2_PREFIX;
    }
    /* Sub-clients */
    /**
     * Get a client for v2 labs endpoints.
     */
    get labs() {
        if (this._labs)
            return this._labs;
        return this._labs = new TwitterApiv2LabsReadOnly(this);
    }
    async search(queryOrOptions, options = {}) {
        const queryParams = typeof queryOrOptions === 'string' ?
            { ...options, query: queryOrOptions } :
            { ...queryOrOptions };
        const initialRq = await this.get('tweets/search/recent', queryParams, { fullResponse: true });
        return new TweetSearchRecentV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * The full-archive search endpoint returns the complete history of public Tweets matching a search query;
     * since the first Tweet was created March 26, 2006.
     *
     * This endpoint is only available to those users who have been approved for the Academic Research product track.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/search/api-reference/get-tweets-search-all
     */
    async searchAll(query, options = {}) {
        const queryParams = { ...options, query };
        const initialRq = await this.get('tweets/search/all', queryParams, { fullResponse: true });
        return new TweetSearchAllV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams,
        });
    }
    /**
     * Returns a variety of information about a single Tweet specified by the requested ID.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/lookup/api-reference/get-tweets-id
     *
     * OAuth2 scope: `users.read`, `tweet.read`
     */
    singleTweet(tweetId, options = {}) {
        return this.get('tweets/:id', options, { params: { id: tweetId } });
    }
    /**
     * Returns a variety of information about tweets specified by list of IDs.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/lookup/api-reference/get-tweets
     *
     * OAuth2 scope: `users.read`, `tweet.read`
     */
    tweets(tweetIds, options = {}) {
        return this.get('tweets', { ids: tweetIds, ...options });
    }
    /**
     * The recent Tweet counts endpoint returns count of Tweets from the last seven days that match a search query.
     * OAuth2 Bearer auth only.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/counts/api-reference/get-tweets-counts-recent
     */
    tweetCountRecent(query, options = {}) {
        return this.get('tweets/counts/recent', { query, ...options });
    }
    /**
     * This endpoint is only available to those users who have been approved for the Academic Research product track.
     * The full-archive search endpoint returns the complete history of public Tweets matching a search query;
     * since the first Tweet was created March 26, 2006.
     * OAuth2 Bearer auth only.
     * **This endpoint has pagination, yet it is not supported by bundled paginators. Use `next_token` to fetch next page.**
     * https://developer.twitter.com/en/docs/twitter-api/tweets/counts/api-reference/get-tweets-counts-all
     */
    tweetCountAll(query, options = {}) {
        return this.get('tweets/counts/all', { query, ...options });
    }
    async tweetRetweetedBy(tweetId, options = {}) {
        const { asPaginator, ...parameters } = options;
        const initialRq = await this.get('tweets/:id/retweeted_by', parameters, {
            fullResponse: true,
            params: { id: tweetId },
        });
        if (!asPaginator) {
            return initialRq.data;
        }
        return new TweetRetweetersUsersV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: parameters,
            sharedParams: { id: tweetId },
        });
    }
    async tweetLikedBy(tweetId, options = {}) {
        const { asPaginator, ...parameters } = options;
        const initialRq = await this.get('tweets/:id/liking_users', parameters, {
            fullResponse: true,
            params: { id: tweetId },
        });
        if (!asPaginator) {
            return initialRq.data;
        }
        return new TweetLikingUsersV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: parameters,
            sharedParams: { id: tweetId },
        });
    }
    /**
     * Allows you to retrieve a collection of the most recent Tweets and Retweets posted by you and users you follow, also known as home timeline.
     * This endpoint returns up to the last 3200 Tweets.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/timelines/api-reference/get-users-id-reverse-chronological
     *
     * OAuth 2 scopes: `tweet.read` `users.read`
     */
    async homeTimeline(options = {}) {
        const meUser = await this.getCurrentUserV2Object();
        const initialRq = await this.get('users/:id/timelines/reverse_chronological', options, {
            fullResponse: true,
            params: { id: meUser.data.id },
        });
        return new TweetHomeTimelineV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: options,
            sharedParams: { id: meUser.data.id },
        });
    }
    /**
     * Returns Tweets composed by a single user, specified by the requested user ID.
     * By default, the most recent ten Tweets are returned per request.
     * Using pagination, the most recent 3,200 Tweets can be retrieved.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/timelines/api-reference/get-users-id-tweets
     */
    async userTimeline(userId, options = {}) {
        const initialRq = await this.get('users/:id/tweets', options, {
            fullResponse: true,
            params: { id: userId },
        });
        return new TweetUserTimelineV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: options,
            sharedParams: { id: userId },
        });
    }
    /**
     * Returns Tweets mentioning a single user specified by the requested user ID.
     * By default, the most recent ten Tweets are returned per request.
     * Using pagination, up to the most recent 800 Tweets can be retrieved.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/timelines/api-reference/get-users-id-mentions
     */
    async userMentionTimeline(userId, options = {}) {
        const initialRq = await this.get('users/:id/mentions', options, {
            fullResponse: true,
            params: { id: userId },
        });
        return new TweetUserMentionTimelineV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: options,
            sharedParams: { id: userId },
        });
    }
    /**
     * Returns Quote Tweets for a Tweet specified by the requested Tweet ID.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/quote-tweets/api-reference/get-tweets-id-quote_tweets
     *
     * OAuth2 scopes: `users.read` `tweet.read`
     */
    async quotes(tweetId, options = {}) {
        const initialRq = await this.get('tweets/:id/quote_tweets', options, {
            fullResponse: true,
            params: { id: tweetId },
        });
        return new QuotedTweetsTimelineV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: options,
            sharedParams: { id: tweetId },
        });
    }
    /* Bookmarks */
    /**
     * Allows you to get information about a authenticated user’s 800 most recent bookmarked Tweets.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/bookmarks/api-reference/get-users-id-bookmarks
     *
     * OAuth2 scopes: `users.read` `tweet.read` `bookmark.read`
     */
    async bookmarks(options = {}) {
        const user = await this.getCurrentUserV2Object();
        const initialRq = await this.get('users/:id/bookmarks', options, {
            fullResponse: true,
            params: { id: user.data.id },
        });
        return new TweetBookmarksTimelineV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: options,
            sharedParams: { id: user.data.id },
        });
    }
    /* Users */
    /**
     * Returns information about an authorized user.
     * https://developer.twitter.com/en/docs/twitter-api/users/lookup/api-reference/get-users-me
     *
     * OAuth2 scopes: `tweet.read` & `users.read`
     */
    me(options = {}) {
        return this.get('users/me', options);
    }
    /**
     * Returns a variety of information about a single user specified by the requested ID.
     * https://developer.twitter.com/en/docs/twitter-api/users/lookup/api-reference/get-users-id
     */
    user(userId, options = {}) {
        return this.get('users/:id', options, { params: { id: userId } });
    }
    /**
     * Returns a variety of information about one or more users specified by the requested IDs.
     * https://developer.twitter.com/en/docs/twitter-api/users/lookup/api-reference/get-users
     */
    users(userIds, options = {}) {
        const ids = Array.isArray(userIds) ? userIds.join(',') : userIds;
        return this.get('users', { ...options, ids });
    }
    /**
     * Returns a variety of information about a single user specified by their username.
     * https://developer.twitter.com/en/docs/twitter-api/users/lookup/api-reference/get-users-by-username-username
     */
    userByUsername(username, options = {}) {
        return this.get('users/by/username/:username', options, { params: { username } });
    }
    /**
     * Returns a variety of information about one or more users specified by their usernames.
     * https://developer.twitter.com/en/docs/twitter-api/users/lookup/api-reference/get-users-by
     *
     * OAuth2 scope: `users.read`, `tweet.read`
     */
    usersByUsernames(usernames, options = {}) {
        usernames = Array.isArray(usernames) ? usernames.join(',') : usernames;
        return this.get('users/by', { ...options, usernames });
    }
    async followers(userId, options = {}) {
        const { asPaginator, ...parameters } = options;
        const params = { id: userId };
        if (!asPaginator) {
            return this.get('users/:id/followers', parameters, { params });
        }
        const initialRq = await this.get('users/:id/followers', parameters, { fullResponse: true, params });
        return new UserFollowersV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: parameters,
            sharedParams: params,
        });
    }
    async following(userId, options = {}) {
        const { asPaginator, ...parameters } = options;
        const params = { id: userId };
        if (!asPaginator) {
            return this.get('users/:id/following', parameters, { params });
        }
        const initialRq = await this.get('users/:id/following', parameters, { fullResponse: true, params });
        return new UserFollowingV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: parameters,
            sharedParams: params,
        });
    }
    /**
     * Allows you to get information about a user’s liked Tweets.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/likes/api-reference/get-users-id-liked_tweets
     */
    async userLikedTweets(userId, options = {}) {
        const params = { id: userId };
        const initialRq = await this.get('users/:id/liked_tweets', options, { fullResponse: true, params });
        return new TweetV2UserLikedTweetsPaginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: { ...options },
            sharedParams: params,
        });
    }
    /**
     * Returns a list of users who are blocked by the authenticating user.
     * https://developer.twitter.com/en/docs/twitter-api/users/blocks/api-reference/get-users-blocking
     */
    async userBlockingUsers(userId, options = {}) {
        const params = { id: userId };
        const initialRq = await this.get('users/:id/blocking', options, { fullResponse: true, params });
        return new UserBlockingUsersV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: { ...options },
            sharedParams: params,
        });
    }
    /**
     * Returns a list of users who are muted by the authenticating user.
     * https://developer.twitter.com/en/docs/twitter-api/users/mutes/api-reference/get-users-muting
     */
    async userMutingUsers(userId, options = {}) {
        const params = { id: userId };
        const initialRq = await this.get('users/:id/muting', options, { fullResponse: true, params });
        return new UserMutingUsersV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: { ...options },
            sharedParams: params,
        });
    }
    /* Lists */
    /**
     * Returns the details of a specified List.
     * https://developer.twitter.com/en/docs/twitter-api/lists/list-lookup/api-reference/get-lists-id
     */
    list(id, options = {}) {
        return this.get('lists/:id', options, { params: { id } });
    }
    /**
     * Returns all Lists owned by the specified user.
     * https://developer.twitter.com/en/docs/twitter-api/lists/list-lookup/api-reference/get-users-id-owned_lists
     */
    async listsOwned(userId, options = {}) {
        const params = { id: userId };
        const initialRq = await this.get('users/:id/owned_lists', options, { fullResponse: true, params });
        return new UserOwnedListsV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: { ...options },
            sharedParams: params,
        });
    }
    /**
     * Returns all Lists a specified user is a member of.
     * https://developer.twitter.com/en/docs/twitter-api/lists/list-members/api-reference/get-users-id-list_memberships
     */
    async listMemberships(userId, options = {}) {
        const params = { id: userId };
        const initialRq = await this.get('users/:id/list_memberships', options, { fullResponse: true, params });
        return new UserListMembershipsV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: { ...options },
            sharedParams: params,
        });
    }
    /**
     * Returns all Lists a specified user follows.
     * https://developer.twitter.com/en/docs/twitter-api/lists/list-follows/api-reference/get-users-id-followed_lists
     */
    async listFollowed(userId, options = {}) {
        const params = { id: userId };
        const initialRq = await this.get('users/:id/followed_lists', options, { fullResponse: true, params });
        return new UserListFollowedV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: { ...options },
            sharedParams: params,
        });
    }
    /**
     * Returns a list of Tweets from the specified List.
     * https://developer.twitter.com/en/docs/twitter-api/lists/list-tweets/api-reference/get-lists-id-tweets
     */
    async listTweets(listId, options = {}) {
        const params = { id: listId };
        const initialRq = await this.get('lists/:id/tweets', options, { fullResponse: true, params });
        return new TweetV2ListTweetsPaginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: { ...options },
            sharedParams: params,
        });
    }
    /**
     * Returns a list of users who are members of the specified List.
     * https://developer.twitter.com/en/docs/twitter-api/lists/list-members/api-reference/get-lists-id-members
     */
    async listMembers(listId, options = {}) {
        const params = { id: listId };
        const initialRq = await this.get('lists/:id/members', options, { fullResponse: true, params });
        return new UserListMembersV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: { ...options },
            sharedParams: params,
        });
    }
    /**
     * Returns a list of users who are followers of the specified List.
     * https://developer.twitter.com/en/docs/twitter-api/lists/list-follows/api-reference/get-lists-id-followers
     */
    async listFollowers(listId, options = {}) {
        const params = { id: listId };
        const initialRq = await this.get('lists/:id/followers', options, { fullResponse: true, params });
        return new UserListFollowersV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: { ...options },
            sharedParams: params,
        });
    }
    /* Direct messages */
    /**
     * Returns a list of Direct Messages for the authenticated user, both sent and received.
     * Direct Message events are returned in reverse chronological order.
     * Supports retrieving events from the previous 30 days.
     *
     * OAuth 2 scopes: `dm.read`, `tweet.read`, `user.read`
     *
     * https://developer.twitter.com/en/docs/twitter-api/direct-messages/lookup/api-reference/get-dm_events
     */
    async listDmEvents(options = {}) {
        const initialRq = await this.get('dm_events', options, { fullResponse: true });
        return new FullDMTimelineV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: { ...options },
        });
    }
    /**
     * Returns a list of Direct Messages (DM) events within a 1-1 conversation with the user specified in the participant_id path parameter.
     * Messages are returned in reverse chronological order.
     *
     * OAuth 2 scopes: `dm.read`, `tweet.read`, `user.read`
     *
     * https://developer.twitter.com/en/docs/twitter-api/direct-messages/lookup/api-reference/get-dm_conversations-dm_conversation_id-dm_events
     */
    async listDmEventsWithParticipant(participantId, options = {}) {
        const params = { participant_id: participantId };
        const initialRq = await this.get('dm_conversations/with/:participant_id/dm_events', options, { fullResponse: true, params });
        return new OneToOneDMTimelineV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: { ...options },
            sharedParams: params,
        });
    }
    /**
     * Returns a list of Direct Messages within a conversation specified in the dm_conversation_id path parameter.
     * Messages are returned in reverse chronological order.
     *
     * OAuth 2 scopes: `dm.read`, `tweet.read`, `user.read`
     *
     * https://developer.twitter.com/en/docs/twitter-api/direct-messages/lookup/api-reference/get-dm_conversations-dm_conversation_id-dm_events
     */
    async listDmEventsOfConversation(dmConversationId, options = {}) {
        const params = { dm_conversation_id: dmConversationId };
        const initialRq = await this.get('dm_conversations/:dm_conversation_id/dm_events', options, { fullResponse: true, params });
        return new ConversationDMTimelineV2Paginator({
            realData: initialRq.data,
            rateLimit: initialRq.rateLimit,
            instance: this,
            queryParams: { ...options },
            sharedParams: params,
        });
    }
    /* Spaces */
    /**
     * Get a single space by ID.
     * https://developer.twitter.com/en/docs/twitter-api/spaces/lookup/api-reference/get-spaces-id
     *
     * OAuth2 scopes: `tweet.read`, `users.read`, `space.read`.
     */
    space(spaceId, options = {}) {
        return this.get('spaces/:id', options, { params: { id: spaceId } });
    }
    /**
     * Get spaces using their IDs.
     * https://developer.twitter.com/en/docs/twitter-api/spaces/lookup/api-reference/get-spaces
     *
     * OAuth2 scopes: `tweet.read`, `users.read`, `space.read`.
     */
    spaces(spaceIds, options = {}) {
        return this.get('spaces', { ids: spaceIds, ...options });
    }
    /**
     * Get spaces using their creator user ID(s). (no pagination available)
     * https://developer.twitter.com/en/docs/twitter-api/spaces/lookup/api-reference/get-spaces-by-creator-ids
     *
     * OAuth2 scopes: `tweet.read`, `users.read`, `space.read`.
     */
    spacesByCreators(creatorIds, options = {}) {
        return this.get('spaces/by/creator_ids', { user_ids: creatorIds, ...options });
    }
    /**
     * Search through spaces using multiple params. (no pagination available)
     * https://developer.twitter.com/en/docs/twitter-api/spaces/search/api-reference/get-spaces-search
     */
    searchSpaces(options) {
        return this.get('spaces/search', options);
    }
    /**
    * Returns a list of user who purchased a ticket to the requested Space.
    * You must authenticate the request using the Access Token of the creator of the requested Space.
    *
    * **OAuth 2.0 Access Token required**
    *
    * https://developer.twitter.com/en/docs/twitter-api/spaces/lookup/api-reference/get-spaces-id-buyers
    *
    * OAuth2 scopes: `tweet.read`, `users.read`, `space.read`.
    */
    spaceBuyers(spaceId, options = {}) {
        return this.get('spaces/:id/buyers', options, { params: { id: spaceId } });
    }
    /**
     * Returns Tweets shared in the requested Spaces.
     * https://developer.twitter.com/en/docs/twitter-api/spaces/lookup/api-reference/get-spaces-id-tweets
     *
     * OAuth2 scope: `users.read`, `tweet.read`, `space.read`
     */
    spaceTweets(spaceId, options = {}) {
        return this.get('spaces/:id/tweets', options, { params: { id: spaceId } });
    }
    searchStream({ autoConnect, ...options } = {}) {
        return this.getStream('tweets/search/stream', options, { payloadIsError: isTweetStreamV2ErrorPayload, autoConnect });
    }
    /**
     * Return a list of rules currently active on the streaming endpoint, either as a list or individually.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/filtered-stream/api-reference/get-tweets-search-stream-rules
     */
    streamRules(options = {}) {
        return this.get('tweets/search/stream/rules', options);
    }
    updateStreamRules(options, query = {}) {
        return this.post('tweets/search/stream/rules', options, { query });
    }
    sampleStream({ autoConnect, ...options } = {}) {
        return this.getStream('tweets/sample/stream', options, { payloadIsError: isTweetStreamV2ErrorPayload, autoConnect });
    }
    sample10Stream({ autoConnect, ...options } = {}) {
        return this.getStream('tweets/sample10/stream', options, { payloadIsError: isTweetStreamV2ErrorPayload, autoConnect });
    }
    /* Batch compliance */
    /**
     * Returns a list of recent compliance jobs.
     * https://developer.twitter.com/en/docs/twitter-api/compliance/batch-compliance/api-reference/get-compliance-jobs
     */
    complianceJobs(options) {
        return this.get('compliance/jobs', options);
    }
    /**
     * Get a single compliance job with the specified ID.
     * https://developer.twitter.com/en/docs/twitter-api/compliance/batch-compliance/api-reference/get-compliance-jobs-id
     */
    complianceJob(jobId) {
        return this.get('compliance/jobs/:id', undefined, { params: { id: jobId } });
    }
    /**
     * Creates a new compliance job for Tweet IDs or user IDs, send your file, await result and parse it into an array.
     * You can run one batch job at a time. Returns the created job, but **not the job result!**.
     *
     * You can obtain the result (**after job is completed**) with `.complianceJobResult`.
     * https://developer.twitter.com/en/docs/twitter-api/compliance/batch-compliance/api-reference/post-compliance-jobs
     */
    async sendComplianceJob(jobParams) {
        const job = await this.post('compliance/jobs', { type: jobParams.type, name: jobParams.name });
        // Send the IDs
        const rawIdsBody = jobParams.ids instanceof Buffer ? jobParams.ids : Buffer.from(jobParams.ids.join('\n'));
        // Upload the IDs
        await this.put(job.data.upload_url, rawIdsBody, {
            forceBodyMode: 'raw',
            enableAuth: false,
            headers: { 'Content-Type': 'text/plain' },
            prefix: '',
        });
        return job;
    }
    /**
     * Get the result of a running or completed job, obtained through `.complianceJob`, `.complianceJobs` or `.sendComplianceJob`.
     * If job is still running (`in_progress`), it will await until job is completed. **This could be quite long!**
     * https://developer.twitter.com/en/docs/twitter-api/compliance/batch-compliance/api-reference/post-compliance-jobs
     */
    async complianceJobResult(job) {
        let runningJob = job;
        while (runningJob.status !== 'complete') {
            if (runningJob.status === 'expired' || runningJob.status === 'failed') {
                throw new Error('Job failed to be completed.');
            }
            await new Promise(resolve => setTimeout(resolve, 3500));
            runningJob = (await this.complianceJob(job.id)).data;
        }
        // Download and parse result
        const result = await this.get(job.download_url, undefined, {
            enableAuth: false,
            prefix: '',
        });
        return result
            .trim()
            .split('\n')
            .filter(line => line)
            .map(line => JSON.parse(line));
    }
}

/**
 * Base Twitter v2 labs client with read/write rights.
 */
class TwitterApiv2LabsReadWrite extends TwitterApiv2LabsReadOnly {
    constructor() {
        super(...arguments);
        this._prefix = API_V2_LABS_PREFIX;
    }
    /**
     * Get a client with only read rights.
     */
    get readOnly() {
        return this;
    }
}

/**
 * Base Twitter v2 client with read/write rights.
 */
class TwitterApiv2ReadWrite extends TwitterApiv2ReadOnly {
    constructor() {
        super(...arguments);
        this._prefix = API_V2_PREFIX;
    }
    /* Sub-clients */
    /**
     * Get a client with only read rights.
     */
    get readOnly() {
        return this;
    }
    /**
     * Get a client for v2 labs endpoints.
     */
    get labs() {
        if (this._labs)
            return this._labs;
        return this._labs = new TwitterApiv2LabsReadWrite(this);
    }
    /* Tweets */
    /**
     * Hides or unhides a reply to a Tweet.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/hide-replies/api-reference/put-tweets-id-hidden
     */
    hideReply(tweetId, makeHidden) {
        return this.put('tweets/:id/hidden', { hidden: makeHidden }, { params: { id: tweetId } });
    }
    /**
     * Causes the user ID identified in the path parameter to Like the target Tweet.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/likes/api-reference/post-users-user_id-likes
     *
     * **Note**: You must specify the currently logged user ID ; you can obtain it through v1.1 API.
     */
    like(loggedUserId, targetTweetId) {
        return this.post('users/:id/likes', { tweet_id: targetTweetId }, { params: { id: loggedUserId } });
    }
    /**
     * Allows a user or authenticated user ID to unlike a Tweet.
     * The request succeeds with no action when the user sends a request to a user they're not liking the Tweet or have already unliked the Tweet.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/likes/api-reference/delete-users-id-likes-tweet_id
     *
     * **Note**: You must specify the currently logged user ID ; you can obtain it through v1.1 API.
     */
    unlike(loggedUserId, targetTweetId) {
        return this.delete('users/:id/likes/:tweet_id', undefined, {
            params: { id: loggedUserId, tweet_id: targetTweetId },
        });
    }
    /**
     * Causes the user ID identified in the path parameter to Retweet the target Tweet.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/retweets/api-reference/post-users-id-retweets
     *
     * **Note**: You must specify the currently logged user ID ; you can obtain it through v1.1 API.
     */
    retweet(loggedUserId, targetTweetId) {
        return this.post('users/:id/retweets', { tweet_id: targetTweetId }, { params: { id: loggedUserId } });
    }
    /**
     * Allows a user or authenticated user ID to remove the Retweet of a Tweet.
     * The request succeeds with no action when the user sends a request to a user they're not Retweeting the Tweet or have already removed the Retweet of.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/retweets/api-reference/delete-users-id-retweets-tweet_id
     *
     * **Note**: You must specify the currently logged user ID ; you can obtain it through v1.1 API.
     */
    unretweet(loggedUserId, targetTweetId) {
        return this.delete('users/:id/retweets/:tweet_id', undefined, {
            params: { id: loggedUserId, tweet_id: targetTweetId },
        });
    }
    tweet(status, payload = {}) {
        if (typeof status === 'object') {
            payload = status;
        }
        else {
            payload = { text: status, ...payload };
        }
        return this.post('tweets', payload);
    }
    /**
     * Reply to a Tweet on behalf of an authenticated user.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets/api-reference/post-tweets
     */
    reply(status, toTweetId, payload = {}) {
        var _a;
        const reply = { in_reply_to_tweet_id: toTweetId, ...(_a = payload.reply) !== null && _a !== void 0 ? _a : {} };
        return this.post('tweets', { text: status, ...payload, reply });
    }
    /**
     * Quote an existing Tweet on behalf of an authenticated user.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets/api-reference/post-tweets
     */
    quote(status, quotedTweetId, payload = {}) {
        return this.tweet(status, { ...payload, quote_tweet_id: quotedTweetId });
    }
    /**
     * Post a series of tweets.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets/api-reference/post-tweets
     */
    async tweetThread(tweets) {
        var _a, _b;
        const postedTweets = [];
        for (const tweet of tweets) {
            // Retrieve the last sent tweet
            const lastTweet = postedTweets.length ? postedTweets[postedTweets.length - 1] : null;
            // Build the tweet query params
            const queryParams = { ...(typeof tweet === 'string' ? ({ text: tweet }) : tweet) };
            // Reply to an existing tweet if needed
            const inReplyToId = lastTweet ? lastTweet.data.id : (_a = queryParams.reply) === null || _a === void 0 ? void 0 : _a.in_reply_to_tweet_id;
            const status = (_b = queryParams.text) !== null && _b !== void 0 ? _b : '';
            if (inReplyToId) {
                postedTweets.push(await this.reply(status, inReplyToId, queryParams));
            }
            else {
                postedTweets.push(await this.tweet(status, queryParams));
            }
        }
        return postedTweets;
    }
    /**
     * Allows a user or authenticated user ID to delete a Tweet
     * https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets/api-reference/delete-tweets-id
     */
    deleteTweet(tweetId) {
        return this.delete('tweets/:id', undefined, {
            params: {
                id: tweetId,
            },
        });
    }
    /* Bookmarks */
    /**
     * Causes the user ID of an authenticated user identified in the path parameter to Bookmark the target Tweet provided in the request body.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/bookmarks/api-reference/post-users-id-bookmarks
     *
     * OAuth2 scopes: `users.read` `tweet.read` `bookmark.write`
     */
    async bookmark(tweetId) {
        const user = await this.getCurrentUserV2Object();
        return this.post('users/:id/bookmarks', { tweet_id: tweetId }, { params: { id: user.data.id } });
    }
    /**
     * Allows a user or authenticated user ID to remove a Bookmark of a Tweet.
     * https://developer.twitter.com/en/docs/twitter-api/tweets/bookmarks/api-reference/delete-users-id-bookmarks-tweet_id
     *
     * OAuth2 scopes: `users.read` `tweet.read` `bookmark.write`
     */
    async deleteBookmark(tweetId) {
        const user = await this.getCurrentUserV2Object();
        return this.delete('users/:id/bookmarks/:tweet_id', undefined, { params: { id: user.data.id, tweet_id: tweetId } });
    }
    /* Users */
    /**
     * Allows a user ID to follow another user.
     * If the target user does not have public Tweets, this endpoint will send a follow request.
     * https://developer.twitter.com/en/docs/twitter-api/users/follows/api-reference/post-users-source_user_id-following
     *
     * OAuth2 scope: `follows.write`
     *
     * **Note**: You must specify the currently logged user ID ; you can obtain it through v1.1 API.
     */
    follow(loggedUserId, targetUserId) {
        return this.post('users/:id/following', { target_user_id: targetUserId }, { params: { id: loggedUserId } });
    }
    /**
     * Allows a user ID to unfollow another user.
     * https://developer.twitter.com/en/docs/twitter-api/users/follows/api-reference/delete-users-source_id-following
     *
     * OAuth2 scope: `follows.write`
     *
     * **Note**: You must specify the currently logged user ID ; you can obtain it through v1.1 API.
     */
    unfollow(loggedUserId, targetUserId) {
        return this.delete('users/:source_user_id/following/:target_user_id', undefined, {
            params: { source_user_id: loggedUserId, target_user_id: targetUserId },
        });
    }
    /**
     * Causes the user (in the path) to block the target user.
     * The user (in the path) must match the user context authorizing the request.
     * https://developer.twitter.com/en/docs/twitter-api/users/blocks/api-reference/post-users-user_id-blocking
     *
     * **Note**: You must specify the currently logged user ID; you can obtain it through v1.1 API.
     */
    block(loggedUserId, targetUserId) {
        return this.post('users/:id/blocking', { target_user_id: targetUserId }, { params: { id: loggedUserId } });
    }
    /**
     * Allows a user or authenticated user ID to unblock another user.
     * https://developer.twitter.com/en/docs/twitter-api/users/blocks/api-reference/delete-users-user_id-blocking
     *
     * **Note**: You must specify the currently logged user ID ; you can obtain it through v1.1 API.
     */
    unblock(loggedUserId, targetUserId) {
        return this.delete('users/:source_user_id/blocking/:target_user_id', undefined, {
            params: { source_user_id: loggedUserId, target_user_id: targetUserId },
        });
    }
    /**
     * Allows an authenticated user ID to mute the target user.
     * https://developer.twitter.com/en/docs/twitter-api/users/mutes/api-reference/post-users-user_id-muting
     *
     * **Note**: You must specify the currently logged user ID ; you can obtain it through v1.1 API.
     */
    mute(loggedUserId, targetUserId) {
        return this.post('users/:id/muting', { target_user_id: targetUserId }, { params: { id: loggedUserId } });
    }
    /**
     * Allows an authenticated user ID to unmute the target user.
     * The request succeeds with no action when the user sends a request to a user they're not muting or have already unmuted.
     * https://developer.twitter.com/en/docs/twitter-api/users/mutes/api-reference/delete-users-user_id-muting
     *
     * **Note**: You must specify the currently logged user ID ; you can obtain it through v1.1 API.
     */
    unmute(loggedUserId, targetUserId) {
        return this.delete('users/:source_user_id/muting/:target_user_id', undefined, {
            params: { source_user_id: loggedUserId, target_user_id: targetUserId },
        });
    }
    /* Lists */
    /**
     * Creates a new list for the authenticated user.
     * https://developer.twitter.com/en/docs/twitter-api/lists/manage-lists/api-reference/post-lists
     */
    createList(options) {
        return this.post('lists', options);
    }
    /**
     * Updates the specified list. The authenticated user must own the list to be able to update it.
     * https://developer.twitter.com/en/docs/twitter-api/lists/manage-lists/api-reference/put-lists-id
     */
    updateList(listId, options = {}) {
        return this.put('lists/:id', options, { params: { id: listId } });
    }
    /**
     * Deletes the specified list. The authenticated user must own the list to be able to destroy it.
     * https://developer.twitter.com/en/docs/twitter-api/lists/manage-lists/api-reference/delete-lists-id
     */
    removeList(listId) {
        return this.delete('lists/:id', undefined, { params: { id: listId } });
    }
    /**
     * Adds a member to a list.
     * https://developer.twitter.com/en/docs/twitter-api/lists/manage-lists/api-reference/post-lists-id-members
     */
    addListMember(listId, userId) {
        return this.post('lists/:id/members', { user_id: userId }, { params: { id: listId } });
    }
    /**
     * Remember a member to a list.
     * https://developer.twitter.com/en/docs/twitter-api/lists/manage-lists/api-reference/delete-lists-id-members-user_id
     */
    removeListMember(listId, userId) {
        return this.delete('lists/:id/members/:user_id', undefined, { params: { id: listId, user_id: userId } });
    }
    /**
     * Subscribes the authenticated user to the specified list.
     * https://developer.twitter.com/en/docs/twitter-api/lists/manage-lists/api-reference/post-users-id-followed-lists
     */
    subscribeToList(loggedUserId, listId) {
        return this.post('users/:id/followed_lists', { list_id: listId }, { params: { id: loggedUserId } });
    }
    /**
     * Unsubscribes the authenticated user to the specified list.
     * https://developer.twitter.com/en/docs/twitter-api/lists/manage-lists/api-reference/delete-users-id-followed-lists-list_id
     */
    unsubscribeOfList(loggedUserId, listId) {
        return this.delete('users/:id/followed_lists/:list_id', undefined, { params: { id: loggedUserId, list_id: listId } });
    }
    /**
     * Enables the authenticated user to pin a List.
     * https://developer.twitter.com/en/docs/twitter-api/lists/manage-lists/api-reference/post-users-id-pinned-lists
     */
    pinList(loggedUserId, listId) {
        return this.post('users/:id/pinned_lists', { list_id: listId }, { params: { id: loggedUserId } });
    }
    /**
     * Enables the authenticated user to unpin a List.
     * https://developer.twitter.com/en/docs/twitter-api/lists/manage-lists/api-reference/delete-users-id-pinned-lists-list_id
     */
    unpinList(loggedUserId, listId) {
        return this.delete('users/:id/pinned_lists/:list_id', undefined, { params: { id: loggedUserId, list_id: listId } });
    }
    /* Direct messages */
    /**
     * Creates a Direct Message on behalf of an authenticated user, and adds it to the specified conversation.
     * https://developer.twitter.com/en/docs/twitter-api/direct-messages/manage/api-reference/post-dm_conversations-dm_conversation_id-messages
     */
    sendDmInConversation(conversationId, message) {
        return this.post('dm_conversations/:dm_conversation_id/messages', message, { params: { dm_conversation_id: conversationId } });
    }
    /**
     * Creates a one-to-one Direct Message and adds it to the one-to-one conversation.
     * This method either creates a new one-to-one conversation or retrieves the current conversation and adds the Direct Message to it.
     * https://developer.twitter.com/en/docs/twitter-api/direct-messages/manage/api-reference/post-dm_conversations-with-participant_id-messages
     */
    sendDmToParticipant(participantId, message) {
        return this.post('dm_conversations/with/:participant_id/messages', message, { params: { participant_id: participantId } });
    }
    /**
     * Creates a new group conversation and adds a Direct Message to it on behalf of an authenticated user.
     * https://developer.twitter.com/en/docs/twitter-api/direct-messages/manage/api-reference/post-dm_conversations
     */
    createDmConversation(options) {
        return this.post('dm_conversations', options);
    }
}

/**
 * Twitter v2 labs client with all rights (read/write/DMs)
 */
class TwitterApiv2Labs extends TwitterApiv2LabsReadWrite {
    constructor() {
        super(...arguments);
        this._prefix = API_V2_LABS_PREFIX;
    }
    /**
     * Get a client with read/write rights.
     */
    get readWrite() {
        return this;
    }
}

/**
 * Twitter v2 client with all rights (read/write/DMs)
 */
class TwitterApiv2 extends TwitterApiv2ReadWrite {
    constructor() {
        super(...arguments);
        this._prefix = API_V2_PREFIX;
        /** API endpoints */
    }
    /* Sub-clients */
    /**
     * Get a client with read/write rights.
     */
    get readWrite() {
        return this;
    }
    /**
     * Get a client for v2 labs endpoints.
     */
    get labs() {
        if (this._labs)
            return this._labs;
        return this._labs = new TwitterApiv2Labs(this);
    }
}

/**
 * Twitter v1.1 and v2 API client.
 */
class TwitterApiReadOnly extends TwitterApiBase {
    /* Direct access to subclients */
    get v1() {
        if (this._v1)
            return this._v1;
        return this._v1 = new TwitterApiv1ReadOnly(this);
    }
    get v2() {
        if (this._v2)
            return this._v2;
        return this._v2 = new TwitterApiv2ReadOnly(this);
    }
    /**
     * Fetch and cache current user.
     * This method can only be called with a OAuth 1.0a user authentication.
     *
     * You can use this method to test if authentication was successful.
     * Next calls to this methods will use the cached user, unless `forceFetch: true` is given.
     */
    async currentUser(forceFetch = false) {
        return await this.getCurrentUserObject(forceFetch);
    }
    /**
     * Fetch and cache current user.
     * This method can only be called with a OAuth 1.0a or OAuth2 user authentication.
     *
     * This can only be the slimest available `UserV2` object, with only id, name and username properties defined.
     * To get a customized `UserV2Result`, use `.v2.me()`
     *
     * You can use this method to test if authentication was successful.
     * Next calls to this methods will use the cached user, unless `forceFetch: true` is given.
     *
     * OAuth2 scopes: `tweet.read` & `users.read`
     */
    async currentUserV2(forceFetch = false) {
        return await this.getCurrentUserV2Object(forceFetch);
    }
    /* Shortcuts to endpoints */
    search(what, options) {
        return this.v2.search(what, options);
    }
    /* Authentication */
    /**
     * Generate the OAuth request token link for user-based OAuth 1.0 auth.
     *
     * ```ts
     * // Instantiate TwitterApi with consumer keys
     * const client = new TwitterApi({ appKey: 'consumer_key', appSecret: 'consumer_secret' });
     *
     * const tokenRequest = await client.generateAuthLink('oob-or-your-callback-url');
     * // redirect end-user to tokenRequest.url
     *
     * // Save tokenRequest.oauth_token_secret somewhere, it will be needed for next auth step.
     * ```
     */
    async generateAuthLink(oauth_callback = 'oob', { authAccessType, linkMode = 'authenticate', forceLogin, screenName, } = {}) {
        const oauthResult = await this.post('https://api.twitter.com/oauth/request_token', { oauth_callback, x_auth_access_type: authAccessType });
        let url = `https://api.twitter.com/oauth/${linkMode}?oauth_token=${encodeURIComponent(oauthResult.oauth_token)}`;
        if (forceLogin !== undefined) {
            url += `&force_login=${encodeURIComponent(forceLogin)}`;
        }
        if (screenName !== undefined) {
            url += `&screen_name=${encodeURIComponent(screenName)}`;
        }
        if (this._requestMaker.hasPlugins()) {
            this._requestMaker.applyPluginMethod('onOAuth1RequestToken', {
                client: this._requestMaker,
                url,
                oauthResult,
            });
        }
        return {
            url,
            ...oauthResult,
        };
    }
    /**
     * Obtain access to user-based OAuth 1.0 auth.
     *
     * After user is redirect from your callback, use obtained oauth_token and oauth_verifier to
     * instantiate the new TwitterApi instance.
     *
     * ```ts
     * // Use the saved oauth_token_secret associated to oauth_token returned by callback
     * const requestClient = new TwitterApi({
     *  appKey: 'consumer_key',
     *  appSecret: 'consumer_secret',
     *  accessToken: 'oauth_token',
     *  accessSecret: 'oauth_token_secret'
     * });
     *
     * // Use oauth_verifier obtained from callback request
     * const { client: userClient } = await requestClient.login('oauth_verifier');
     *
     * // {userClient} is a valid {TwitterApi} object you can use for future requests
     * ```
     */
    async login(oauth_verifier) {
        const tokens = this.getActiveTokens();
        if (tokens.type !== 'oauth-1.0a')
            throw new Error('You must setup TwitterApi instance with consumer keys to accept OAuth 1.0 login');
        const oauth_result = await this.post('https://api.twitter.com/oauth/access_token', { oauth_token: tokens.accessToken, oauth_verifier });
        const client = new TwitterApi({
            appKey: tokens.appKey,
            appSecret: tokens.appSecret,
            accessToken: oauth_result.oauth_token,
            accessSecret: oauth_result.oauth_token_secret,
        }, this._requestMaker.clientSettings);
        return {
            accessToken: oauth_result.oauth_token,
            accessSecret: oauth_result.oauth_token_secret,
            userId: oauth_result.user_id,
            screenName: oauth_result.screen_name,
            client,
        };
    }
    /**
     * Enable application-only authentication.
     *
     * To make the request, instantiate TwitterApi with consumer and secret.
     *
     * ```ts
     * const requestClient = new TwitterApi({ appKey: 'consumer', appSecret: 'secret' });
     * const appClient = await requestClient.appLogin();
     *
     * // Use {appClient} to make requests
     * ```
     */
    async appLogin() {
        const tokens = this.getActiveTokens();
        if (tokens.type !== 'oauth-1.0a')
            throw new Error('You must setup TwitterApi instance with consumer keys to accept app-only login');
        // Create a client with Basic authentication
        const basicClient = new TwitterApi({ username: tokens.appKey, password: tokens.appSecret }, this._requestMaker.clientSettings);
        const res = await basicClient.post('https://api.twitter.com/oauth2/token', { grant_type: 'client_credentials' });
        // New object with Bearer token
        return new TwitterApi(res.access_token, this._requestMaker.clientSettings);
    }
    /* OAuth 2 user authentication */
    /**
     * Generate the OAuth request token link for user-based OAuth 2.0 auth.
     *
     * - **You can only use v2 API endpoints with this authentication method.**
     * - **You need to specify which scope you want to have when you create your auth link. Make sure it matches your needs.**
     *
     * See https://developer.twitter.com/en/docs/authentication/oauth-2-0/user-access-token for details.
     *
     * ```ts
     * // Instantiate TwitterApi with client ID
     * const client = new TwitterApi({ clientId: 'yourClientId' });
     *
     * // Generate a link to callback URL that will gives a token with tweet+user read access
     * const link = client.generateOAuth2AuthLink('your-callback-url', { scope: ['tweet.read', 'users.read'] });
     *
     * // Extract props from generate link
     * const { url, state, codeVerifier } = link;
     *
     * // redirect end-user to url
     * // Save `state` and `codeVerifier` somewhere, it will be needed for next auth step.
     * ```
     */
    generateOAuth2AuthLink(redirectUri, options = {}) {
        var _a, _b;
        if (!this._requestMaker.clientId) {
            throw new Error('Twitter API instance is not initialized with client ID. You can find your client ID in Twitter Developer Portal. ' +
                'Please build an instance with: new TwitterApi({ clientId: \'<yourClientId>\' })');
        }
        const state = (_a = options.state) !== null && _a !== void 0 ? _a : OAuth2Helper.generateRandomString(32);
        const codeVerifier = OAuth2Helper.getCodeVerifier();
        const codeChallenge = OAuth2Helper.getCodeChallengeFromVerifier(codeVerifier);
        const rawScope = (_b = options.scope) !== null && _b !== void 0 ? _b : '';
        const scope = Array.isArray(rawScope) ? rawScope.join(' ') : rawScope;
        const url = new URL('https://twitter.com/i/oauth2/authorize');
        const query = {
            response_type: 'code',
            client_id: this._requestMaker.clientId,
            redirect_uri: redirectUri,
            state,
            code_challenge: codeChallenge,
            code_challenge_method: 's256',
            scope,
        };
        RequestParamHelpers.addQueryParamsToUrl(url, query);
        const result = {
            url: url.toString(),
            state,
            codeVerifier,
            codeChallenge,
        };
        if (this._requestMaker.hasPlugins()) {
            this._requestMaker.applyPluginMethod('onOAuth2RequestToken', {
                client: this._requestMaker,
                result,
                redirectUri,
            });
        }
        return result;
    }
    /**
     * Obtain access to user-based OAuth 2.0 auth.
     *
     * After user is redirect from your callback, use obtained code to
     * instantiate the new TwitterApi instance.
     *
     * You need to obtain `codeVerifier` from a call to `.generateOAuth2AuthLink`.
     *
     * ```ts
     * // Use the saved codeVerifier associated to state (present in query string of callback)
     * const requestClient = new TwitterApi({ clientId: 'yourClientId' });
     *
     * const { client: userClient, refreshToken } = await requestClient.loginWithOAuth2({
     *  code: 'codeFromQueryString',
     *  // the same URL given to generateOAuth2AuthLink
     *  redirectUri,
     *  // the verifier returned by generateOAuth2AuthLink
     *  codeVerifier,
     * });
     *
     * // {userClient} is a valid {TwitterApi} object you can use for future requests
     * // {refreshToken} is defined if 'offline.access' is in scope.
     * ```
     */
    async loginWithOAuth2({ code, codeVerifier, redirectUri }) {
        if (!this._requestMaker.clientId) {
            throw new Error('Twitter API instance is not initialized with client ID. ' +
                'Please build an instance with: new TwitterApi({ clientId: \'<yourClientId>\' })');
        }
        const accessTokenResult = await this.post('https://api.twitter.com/2/oauth2/token', {
            code,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
            client_id: this._requestMaker.clientId,
            client_secret: this._requestMaker.clientSecret,
        });
        return this.parseOAuth2AccessTokenResult(accessTokenResult);
    }
    /**
     * Obtain a new access token to user-based OAuth 2.0 auth from a refresh token.
     *
     * ```ts
     * const requestClient = new TwitterApi({ clientId: 'yourClientId' });
     *
     * const { client: userClient } = await requestClient.refreshOAuth2Token('refreshToken');
     * // {userClient} is a valid {TwitterApi} object you can use for future requests
     * ```
     */
    async refreshOAuth2Token(refreshToken) {
        if (!this._requestMaker.clientId) {
            throw new Error('Twitter API instance is not initialized with client ID. ' +
                'Please build an instance with: new TwitterApi({ clientId: \'<yourClientId>\' })');
        }
        const accessTokenResult = await this.post('https://api.twitter.com/2/oauth2/token', {
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            client_id: this._requestMaker.clientId,
            client_secret: this._requestMaker.clientSecret,
        });
        return this.parseOAuth2AccessTokenResult(accessTokenResult);
    }
    /**
     * Revoke a single user-based OAuth 2.0 token.
     *
     * You must specify its source, access token (directly after login)
     * or refresh token (if you've called `.refreshOAuth2Token` before).
     */
    async revokeOAuth2Token(token, tokenType = 'access_token') {
        if (!this._requestMaker.clientId) {
            throw new Error('Twitter API instance is not initialized with client ID. ' +
                'Please build an instance with: new TwitterApi({ clientId: \'<yourClientId>\' })');
        }
        return await this.post('https://api.twitter.com/2/oauth2/revoke', {
            client_id: this._requestMaker.clientId,
            client_secret: this._requestMaker.clientSecret,
            token,
            token_type_hint: tokenType,
        });
    }
    parseOAuth2AccessTokenResult(result) {
        const client = new TwitterApi(result.access_token, this._requestMaker.clientSettings);
        const scope = result.scope.split(' ').filter(e => e);
        return {
            client,
            expiresIn: result.expires_in,
            accessToken: result.access_token,
            scope,
            refreshToken: result.refresh_token,
        };
    }
}

/**
 * Twitter v1.1 and v2 API client.
 */
class TwitterApiReadWrite extends TwitterApiReadOnly {
    /* Direct access to subclients */
    get v1() {
        if (this._v1)
            return this._v1;
        return this._v1 = new TwitterApiv1ReadWrite(this);
    }
    get v2() {
        if (this._v2)
            return this._v2;
        return this._v2 = new TwitterApiv2ReadWrite(this);
    }
    /**
     * Get a client with read only rights.
     */
    get readOnly() {
        return this;
    }
}

// "Real" exported client for usage of TwitterApi.
/**
 * Twitter v1.1 and v2 API client.
 */
class TwitterApi extends TwitterApiReadWrite {
    /* Direct access to subclients */
    get v1() {
        if (this._v1)
            return this._v1;
        return this._v1 = new TwitterApiv1(this);
    }
    get v2() {
        if (this._v2)
            return this._v2;
        return this._v2 = new TwitterApiv2(this);
    }
    /**
     * Get a client with read/write rights.
     */
    get readWrite() {
        return this;
    }
    /* Static helpers */
    static getErrors(error) {
        var _a;
        if (typeof error !== 'object')
            return [];
        if (!('data' in error))
            return [];
        return (_a = error.data.errors) !== null && _a !== void 0 ? _a : [];
    }
    /** Extract another image size than obtained in a `profile_image_url` or `profile_image_url_https` field of a user object. */
    static getProfileImageInSize(profileImageUrl, size) {
        const lastPart = profileImageUrl.split('/').pop();
        const sizes = ['normal', 'bigger', 'mini'];
        let originalUrl = profileImageUrl;
        for (const availableSize of sizes) {
            if (lastPart.includes(`_${availableSize}`)) {
                originalUrl = profileImageUrl.replace(`_${availableSize}`, '');
                break;
            }
        }
        if (size === 'original') {
            return originalUrl;
        }
        const extPos = originalUrl.lastIndexOf('.');
        if (extPos !== -1) {
            const ext = originalUrl.slice(extPos + 1);
            return originalUrl.slice(0, extPos) + '_' + size + '.' + ext;
        }
        else {
            return originalUrl + '_' + size;
        }
    }
}

class LogManager {
    register(logger) {
        LogManager.loggers.push(logger);
        return this;
    }
    logError(message) {
        LogManager.loggers.forEach(logger => logger.logError(message));
    }
    logWarning(message) {
        LogManager.loggers.forEach(logger => logger.logError(message));
    }
    logMessage(message) {
        LogManager.loggers.forEach(logger => logger.logMessage(message));
    }
}
LogManager.loggers = [];
const log = new LogManager();

class TwitterHandler {
    constructor(plugin) {
        this.plugin = plugin;
        this.isConnectedToTwitter = false;
        this.IMAGE_REGEX = new RegExp(/!?\[\[([a-zA-Z 0-9-\.]*\.(gif|jpe?g|tiff?|png|webp|bmp))\]\]/);
    }
    connectToTwitter(apiKey, apiSecret, accessToken, accessTokenSecret) {
        try {
            this.twitterClient = new TwitterApi({
                appKey: apiKey,
                appSecret: apiSecret,
                accessToken: accessToken,
                accessSecret: accessTokenSecret,
            });
            this.isConnectedToTwitter = true;
        }
        catch (e) {
            this.isConnectedToTwitter = false;
        }
    }
    async postThread(threadContent) {
        let tweets = [];
        for (const threadTweet of threadContent) {
            const tweet = await this.constructTweet(threadTweet);
            tweets.push(tweet);
        }
        try {
            return await this.twitterClient.v2.tweetThread(tweets);
        }
        catch (e) {
            console.log(`error in posting tweet thread: ${e}`);
        }
    }
    async postTweet(tweetText) {
        const tweet = await this.constructTweet(tweetText);
        try {
            return await this.twitterClient.v2.tweet(tweet);
        }
        catch (e) {
            console.log(`error in posting tweet. ${e}`);
        }
    }
    async constructTweet(tweet) {
        let media_ids = [];
        let processedTweet = tweet;
        while (this.IMAGE_REGEX.test(processedTweet)) {
            const match = this.IMAGE_REGEX.exec(processedTweet);
            const fileName = match[1];
            const media_id = await this.twitterClient.v1.uploadMedia(fileName);
            if (media_id) {
                media_ids.push(media_id);
                processedTweet = processedTweet.replace(this.IMAGE_REGEX, "");
            }
            else {
                log.logWarning(`image '${fileName}' found but could not upload it to Twitter. Data is null/undefined: ${!!media_ids}.`);
            }
        }
        return Object.assign({ text: processedTweet }, (media_ids.length > 0 ? { media: { media_ids } } : {}));
    }
    async deleteTweets(tweets) {
        try {
            for (const tweet of tweets)
                await this.twitterClient.v2.deleteTweet(tweet.id);
            return true;
        }
        catch (e) {
            log.logError(`error in deleting tweets. ${e}`);
            return false;
        }
    }
}

/* eslint-disable no-use-before-define */

/**
 * Base class for inheritance.
 */
class Base {
  /**
   * Extends this object and runs the init method.
   * Arguments to create() will be passed to init().
   *
   * @return {Object} The new object.
   *
   * @static
   *
   * @example
   *
   *     var instance = MyType.create();
   */
  static create(...args) {
    return new this(...args);
  }

  /**
   * Copies properties into this object.
   *
   * @param {Object} properties The properties to mix in.
   *
   * @example
   *
   *     MyType.mixIn({
   *         field: 'value'
   *     });
   */
  mixIn(properties) {
    return Object.assign(this, properties);
  }

  /**
   * Creates a copy of this object.
   *
   * @return {Object} The clone.
   *
   * @example
   *
   *     var clone = instance.clone();
   */
  clone() {
    const clone = new this.constructor();
    Object.assign(clone, this);
    return clone;
  }
}

/**
 * An array of 32-bit words.
 *
 * @property {Array} words The array of 32-bit words.
 * @property {number} sigBytes The number of significant bytes in this word array.
 */
class WordArray extends Base {
  /**
   * Initializes a newly created word array.
   *
   * @param {Array} words (Optional) An array of 32-bit words.
   * @param {number} sigBytes (Optional) The number of significant bytes in the words.
   *
   * @example
   *
   *     var wordArray = CryptoJS.lib.WordArray.create();
   *     var wordArray = CryptoJS.lib.WordArray.create([0x00010203, 0x04050607]);
   *     var wordArray = CryptoJS.lib.WordArray.create([0x00010203, 0x04050607], 6);
   */
  constructor(words = [], sigBytes = words.length * 4) {
    super();

    let typedArray = words;
    // Convert buffers to uint8
    if (typedArray instanceof ArrayBuffer) {
      typedArray = new Uint8Array(typedArray);
    }

    // Convert other array views to uint8
    if (
      typedArray instanceof Int8Array
      || typedArray instanceof Uint8ClampedArray
      || typedArray instanceof Int16Array
      || typedArray instanceof Uint16Array
      || typedArray instanceof Int32Array
      || typedArray instanceof Uint32Array
      || typedArray instanceof Float32Array
      || typedArray instanceof Float64Array
    ) {
      typedArray = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    }

    // Handle Uint8Array
    if (typedArray instanceof Uint8Array) {
      // Shortcut
      const typedArrayByteLength = typedArray.byteLength;

      // Extract bytes
      const _words = [];
      for (let i = 0; i < typedArrayByteLength; i += 1) {
        _words[i >>> 2] |= typedArray[i] << (24 - (i % 4) * 8);
      }

      // Initialize this word array
      this.words = _words;
      this.sigBytes = typedArrayByteLength;
    } else {
      // Else call normal init
      this.words = words;
      this.sigBytes = sigBytes;
    }
  }

  /**
   * Creates a word array filled with random bytes.
   *
   * @param {number} nBytes The number of random bytes to generate.
   *
   * @return {WordArray} The random word array.
   *
   * @static
   *
   * @example
   *
   *     var wordArray = CryptoJS.lib.WordArray.random(16);
   */
  static random(nBytes) {
    const words = [];

    const r = (m_w) => {
      let _m_w = m_w;
      let _m_z = 0x3ade68b1;
      const mask = 0xffffffff;

      return () => {
        _m_z = (0x9069 * (_m_z & 0xFFFF) + (_m_z >> 0x10)) & mask;
        _m_w = (0x4650 * (_m_w & 0xFFFF) + (_m_w >> 0x10)) & mask;
        let result = ((_m_z << 0x10) + _m_w) & mask;
        result /= 0x100000000;
        result += 0.5;
        return result * (Math.random() > 0.5 ? 1 : -1);
      };
    };

    for (let i = 0, rcache; i < nBytes; i += 4) {
      const _r = r((rcache || Math.random()) * 0x100000000);

      rcache = _r() * 0x3ade67b7;
      words.push((_r() * 0x100000000) | 0);
    }

    return new WordArray(words, nBytes);
  }

  /**
   * Converts this word array to a string.
   *
   * @param {Encoder} encoder (Optional) The encoding strategy to use. Default: CryptoJS.enc.Hex
   *
   * @return {string} The stringified word array.
   *
   * @example
   *
   *     var string = wordArray + '';
   *     var string = wordArray.toString();
   *     var string = wordArray.toString(CryptoJS.enc.Utf8);
   */
  toString(encoder = Hex) {
    return encoder.stringify(this);
  }

  /**
   * Concatenates a word array to this word array.
   *
   * @param {WordArray} wordArray The word array to append.
   *
   * @return {WordArray} This word array.
   *
   * @example
   *
   *     wordArray1.concat(wordArray2);
   */
  concat(wordArray) {
    // Shortcuts
    const thisWords = this.words;
    const thatWords = wordArray.words;
    const thisSigBytes = this.sigBytes;
    const thatSigBytes = wordArray.sigBytes;

    // Clamp excess bits
    this.clamp();

    // Concat
    if (thisSigBytes % 4) {
      // Copy one byte at a time
      for (let i = 0; i < thatSigBytes; i += 1) {
        const thatByte = (thatWords[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
        thisWords[(thisSigBytes + i) >>> 2] |= thatByte << (24 - ((thisSigBytes + i) % 4) * 8);
      }
    } else {
      // Copy one word at a time
      for (let i = 0; i < thatSigBytes; i += 4) {
        thisWords[(thisSigBytes + i) >>> 2] = thatWords[i >>> 2];
      }
    }
    this.sigBytes += thatSigBytes;

    // Chainable
    return this;
  }

  /**
   * Removes insignificant bits.
   *
   * @example
   *
   *     wordArray.clamp();
   */
  clamp() {
    // Shortcuts
    const { words, sigBytes } = this;

    // Clamp
    words[sigBytes >>> 2] &= 0xffffffff << (32 - (sigBytes % 4) * 8);
    words.length = Math.ceil(sigBytes / 4);
  }

  /**
   * Creates a copy of this word array.
   *
   * @return {WordArray} The clone.
   *
   * @example
   *
   *     var clone = wordArray.clone();
   */
  clone() {
    const clone = super.clone.call(this);
    clone.words = this.words.slice(0);

    return clone;
  }
}

/**
 * Hex encoding strategy.
 */
const Hex = {
  /**
   * Converts a word array to a hex string.
   *
   * @param {WordArray} wordArray The word array.
   *
   * @return {string} The hex string.
   *
   * @static
   *
   * @example
   *
   *     var hexString = CryptoJS.enc.Hex.stringify(wordArray);
   */
  stringify(wordArray) {
    // Shortcuts
    const { words, sigBytes } = wordArray;

    // Convert
    const hexChars = [];
    for (let i = 0; i < sigBytes; i += 1) {
      const bite = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
      hexChars.push((bite >>> 4).toString(16));
      hexChars.push((bite & 0x0f).toString(16));
    }

    return hexChars.join('');
  },

  /**
   * Converts a hex string to a word array.
   *
   * @param {string} hexStr The hex string.
   *
   * @return {WordArray} The word array.
   *
   * @static
   *
   * @example
   *
   *     var wordArray = CryptoJS.enc.Hex.parse(hexString);
   */
  parse(hexStr) {
    // Shortcut
    const hexStrLength = hexStr.length;

    // Convert
    const words = [];
    for (let i = 0; i < hexStrLength; i += 2) {
      words[i >>> 3] |= parseInt(hexStr.substr(i, 2), 16) << (24 - (i % 8) * 4);
    }

    return new WordArray(words, hexStrLength / 2);
  },
};

/**
 * Latin1 encoding strategy.
 */
const Latin1 = {
  /**
   * Converts a word array to a Latin1 string.
   *
   * @param {WordArray} wordArray The word array.
   *
   * @return {string} The Latin1 string.
   *
   * @static
   *
   * @example
   *
   *     var latin1String = CryptoJS.enc.Latin1.stringify(wordArray);
   */
  stringify(wordArray) {
    // Shortcuts
    const { words, sigBytes } = wordArray;

    // Convert
    const latin1Chars = [];
    for (let i = 0; i < sigBytes; i += 1) {
      const bite = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
      latin1Chars.push(String.fromCharCode(bite));
    }

    return latin1Chars.join('');
  },

  /**
   * Converts a Latin1 string to a word array.
   *
   * @param {string} latin1Str The Latin1 string.
   *
   * @return {WordArray} The word array.
   *
   * @static
   *
   * @example
   *
   *     var wordArray = CryptoJS.enc.Latin1.parse(latin1String);
   */
  parse(latin1Str) {
    // Shortcut
    const latin1StrLength = latin1Str.length;

    // Convert
    const words = [];
    for (let i = 0; i < latin1StrLength; i += 1) {
      words[i >>> 2] |= (latin1Str.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
    }

    return new WordArray(words, latin1StrLength);
  },
};

/**
 * UTF-8 encoding strategy.
 */
const Utf8 = {
  /**
   * Converts a word array to a UTF-8 string.
   *
   * @param {WordArray} wordArray The word array.
   *
   * @return {string} The UTF-8 string.
   *
   * @static
   *
   * @example
   *
   *     var utf8String = CryptoJS.enc.Utf8.stringify(wordArray);
   */
  stringify(wordArray) {
    try {
      return decodeURIComponent(escape(Latin1.stringify(wordArray)));
    } catch (e) {
      throw new Error('Malformed UTF-8 data');
    }
  },

  /**
   * Converts a UTF-8 string to a word array.
   *
   * @param {string} utf8Str The UTF-8 string.
   *
   * @return {WordArray} The word array.
   *
   * @static
   *
   * @example
   *
   *     var wordArray = CryptoJS.enc.Utf8.parse(utf8String);
   */
  parse(utf8Str) {
    return Latin1.parse(unescape(encodeURIComponent(utf8Str)));
  },
};

/**
 * Abstract buffered block algorithm template.
 *
 * The property blockSize must be implemented in a concrete subtype.
 *
 * @property {number} _minBufferSize
 *
 *     The number of blocks that should be kept unprocessed in the buffer. Default: 0
 */
class BufferedBlockAlgorithm extends Base {
  constructor() {
    super();
    this._minBufferSize = 0;
  }

  /**
   * Resets this block algorithm's data buffer to its initial state.
   *
   * @example
   *
   *     bufferedBlockAlgorithm.reset();
   */
  reset() {
    // Initial values
    this._data = new WordArray();
    this._nDataBytes = 0;
  }

  /**
   * Adds new data to this block algorithm's buffer.
   *
   * @param {WordArray|string} data
   *
   *     The data to append. Strings are converted to a WordArray using UTF-8.
   *
   * @example
   *
   *     bufferedBlockAlgorithm._append('data');
   *     bufferedBlockAlgorithm._append(wordArray);
   */
  _append(data) {
    let m_data = data;

    // Convert string to WordArray, else assume WordArray already
    if (typeof m_data === 'string') {
      m_data = Utf8.parse(m_data);
    }

    // Append
    this._data.concat(m_data);
    this._nDataBytes += m_data.sigBytes;
  }

  /**
   * Processes available data blocks.
   *
   * This method invokes _doProcessBlock(offset), which must be implemented by a concrete subtype.
   *
   * @param {boolean} doFlush Whether all blocks and partial blocks should be processed.
   *
   * @return {WordArray} The processed data.
   *
   * @example
   *
   *     var processedData = bufferedBlockAlgorithm._process();
   *     var processedData = bufferedBlockAlgorithm._process(!!'flush');
   */
  _process(doFlush) {
    let processedWords;

    // Shortcuts
    const { _data: data, blockSize } = this;
    const dataWords = data.words;
    const dataSigBytes = data.sigBytes;
    const blockSizeBytes = blockSize * 4;

    // Count blocks ready
    let nBlocksReady = dataSigBytes / blockSizeBytes;
    if (doFlush) {
      // Round up to include partial blocks
      nBlocksReady = Math.ceil(nBlocksReady);
    } else {
      // Round down to include only full blocks,
      // less the number of blocks that must remain in the buffer
      nBlocksReady = Math.max((nBlocksReady | 0) - this._minBufferSize, 0);
    }

    // Count words ready
    const nWordsReady = nBlocksReady * blockSize;

    // Count bytes ready
    const nBytesReady = Math.min(nWordsReady * 4, dataSigBytes);

    // Process blocks
    if (nWordsReady) {
      for (let offset = 0; offset < nWordsReady; offset += blockSize) {
        // Perform concrete-algorithm logic
        this._doProcessBlock(dataWords, offset);
      }

      // Remove processed words
      processedWords = dataWords.splice(0, nWordsReady);
      data.sigBytes -= nBytesReady;
    }

    // Return processed words
    return new WordArray(processedWords, nBytesReady);
  }

  /**
   * Creates a copy of this object.
   *
   * @return {Object} The clone.
   *
   * @example
   *
   *     var clone = bufferedBlockAlgorithm.clone();
   */
  clone() {
    const clone = super.clone.call(this);
    clone._data = this._data.clone();

    return clone;
  }
}

/**
 * Abstract hasher template.
 *
 * @property {number} blockSize
 *
 *     The number of 32-bit words this hasher operates on. Default: 16 (512 bits)
 */
class Hasher extends BufferedBlockAlgorithm {
  constructor(cfg) {
    super();

    this.blockSize = 512 / 32;

    /**
     * Configuration options.
     */
    this.cfg = Object.assign(new Base(), cfg);

    // Set initial values
    this.reset();
  }

  /**
   * Creates a shortcut function to a hasher's object interface.
   *
   * @param {Hasher} SubHasher The hasher to create a helper for.
   *
   * @return {Function} The shortcut function.
   *
   * @static
   *
   * @example
   *
   *     var SHA256 = CryptoJS.lib.Hasher._createHelper(CryptoJS.algo.SHA256);
   */
  static _createHelper(SubHasher) {
    return (message, cfg) => new SubHasher(cfg).finalize(message);
  }

  /**
   * Creates a shortcut function to the HMAC's object interface.
   *
   * @param {Hasher} SubHasher The hasher to use in this HMAC helper.
   *
   * @return {Function} The shortcut function.
   *
   * @static
   *
   * @example
   *
   *     var HmacSHA256 = CryptoJS.lib.Hasher._createHmacHelper(CryptoJS.algo.SHA256);
   */
  static _createHmacHelper(SubHasher) {
    return (message, key) => new HMAC(SubHasher, key).finalize(message);
  }

  /**
   * Resets this hasher to its initial state.
   *
   * @example
   *
   *     hasher.reset();
   */
  reset() {
    // Reset data buffer
    super.reset.call(this);

    // Perform concrete-hasher logic
    this._doReset();
  }

  /**
   * Updates this hasher with a message.
   *
   * @param {WordArray|string} messageUpdate The message to append.
   *
   * @return {Hasher} This hasher.
   *
   * @example
   *
   *     hasher.update('message');
   *     hasher.update(wordArray);
   */
  update(messageUpdate) {
    // Append
    this._append(messageUpdate);

    // Update the hash
    this._process();

    // Chainable
    return this;
  }

  /**
   * Finalizes the hash computation.
   * Note that the finalize operation is effectively a destructive, read-once operation.
   *
   * @param {WordArray|string} messageUpdate (Optional) A final message update.
   *
   * @return {WordArray} The hash.
   *
   * @example
   *
   *     var hash = hasher.finalize();
   *     var hash = hasher.finalize('message');
   *     var hash = hasher.finalize(wordArray);
   */
  finalize(messageUpdate) {
    // Final message update
    if (messageUpdate) {
      this._append(messageUpdate);
    }

    // Perform concrete-hasher logic
    const hash = this._doFinalize();

    return hash;
  }
}

/**
 * HMAC algorithm.
 */
class HMAC extends Base {
  /**
   * Initializes a newly created HMAC.
   *
   * @param {Hasher} SubHasher The hash algorithm to use.
   * @param {WordArray|string} key The secret key.
   *
   * @example
   *
   *     var hmacHasher = CryptoJS.algo.HMAC.create(CryptoJS.algo.SHA256, key);
   */
  constructor(SubHasher, key) {
    super();

    const hasher = new SubHasher();
    this._hasher = hasher;

    // Convert string to WordArray, else assume WordArray already
    let _key = key;
    if (typeof _key === 'string') {
      _key = Utf8.parse(_key);
    }

    // Shortcuts
    const hasherBlockSize = hasher.blockSize;
    const hasherBlockSizeBytes = hasherBlockSize * 4;

    // Allow arbitrary length keys
    if (_key.sigBytes > hasherBlockSizeBytes) {
      _key = hasher.finalize(key);
    }

    // Clamp excess bits
    _key.clamp();

    // Clone key for inner and outer pads
    const oKey = _key.clone();
    this._oKey = oKey;
    const iKey = _key.clone();
    this._iKey = iKey;

    // Shortcuts
    const oKeyWords = oKey.words;
    const iKeyWords = iKey.words;

    // XOR keys with pad constants
    for (let i = 0; i < hasherBlockSize; i += 1) {
      oKeyWords[i] ^= 0x5c5c5c5c;
      iKeyWords[i] ^= 0x36363636;
    }
    oKey.sigBytes = hasherBlockSizeBytes;
    iKey.sigBytes = hasherBlockSizeBytes;

    // Set initial values
    this.reset();
  }

  /**
   * Resets this HMAC to its initial state.
   *
   * @example
   *
   *     hmacHasher.reset();
   */
  reset() {
    // Shortcut
    const hasher = this._hasher;

    // Reset
    hasher.reset();
    hasher.update(this._iKey);
  }

  /**
   * Updates this HMAC with a message.
   *
   * @param {WordArray|string} messageUpdate The message to append.
   *
   * @return {HMAC} This HMAC instance.
   *
   * @example
   *
   *     hmacHasher.update('message');
   *     hmacHasher.update(wordArray);
   */
  update(messageUpdate) {
    this._hasher.update(messageUpdate);

    // Chainable
    return this;
  }

  /**
   * Finalizes the HMAC computation.
   * Note that the finalize operation is effectively a destructive, read-once operation.
   *
   * @param {WordArray|string} messageUpdate (Optional) A final message update.
   *
   * @return {WordArray} The HMAC.
   *
   * @example
   *
   *     var hmac = hmacHasher.finalize();
   *     var hmac = hmacHasher.finalize('message');
   *     var hmac = hmacHasher.finalize(wordArray);
   */
  finalize(messageUpdate) {
    // Shortcut
    const hasher = this._hasher;

    // Compute HMAC
    const innerHash = hasher.finalize(messageUpdate);
    hasher.reset();
    const hmac = hasher.finalize(this._oKey.clone().concat(innerHash));

    return hmac;
  }
}

const X32WordArray = WordArray;

/**
 * A 64-bit word.
 */
class X64Word extends Base {
  /**
   * Initializes a newly created 64-bit word.
   *
   * @param {number} high The high 32 bits.
   * @param {number} low The low 32 bits.
   *
   * @example
   *
   *     var x64Word = CryptoJS.x64.Word.create(0x00010203, 0x04050607);
   */
  constructor(high, low) {
    super();

    this.high = high;
    this.low = low;
  }
}

/**
 * An array of 64-bit words.
 *
 * @property {Array} words The array of CryptoJS.x64.Word objects.
 * @property {number} sigBytes The number of significant bytes in this word array.
 */
class X64WordArray extends Base {
  /**
   * Initializes a newly created word array.
   *
   * @param {Array} words (Optional) An array of CryptoJS.x64.Word objects.
   * @param {number} sigBytes (Optional) The number of significant bytes in the words.
   *
   * @example
   *
   *     var wordArray = CryptoJS.x64.WordArray.create();
   *
   *     var wordArray = CryptoJS.x64.WordArray.create([
   *         CryptoJS.x64.Word.create(0x00010203, 0x04050607),
   *         CryptoJS.x64.Word.create(0x18191a1b, 0x1c1d1e1f)
   *     ]);
   *
   *     var wordArray = CryptoJS.x64.WordArray.create([
   *         CryptoJS.x64.Word.create(0x00010203, 0x04050607),
   *         CryptoJS.x64.Word.create(0x18191a1b, 0x1c1d1e1f)
   *     ], 10);
   */
  constructor(words = [], sigBytes = words.length * 8) {
    super();

    this.words = words;
    this.sigBytes = sigBytes;
  }

  /**
   * Converts this 64-bit word array to a 32-bit word array.
   *
   * @return {CryptoJS.lib.WordArray} This word array's data as a 32-bit word array.
   *
   * @example
   *
   *     var x32WordArray = x64WordArray.toX32();
   */
  toX32() {
    // Shortcuts
    const x64Words = this.words;
    const x64WordsLength = x64Words.length;

    // Convert
    const x32Words = [];
    for (let i = 0; i < x64WordsLength; i += 1) {
      const x64Word = x64Words[i];
      x32Words.push(x64Word.high);
      x32Words.push(x64Word.low);
    }

    return X32WordArray.create(x32Words, this.sigBytes);
  }

  /**
   * Creates a copy of this word array.
   *
   * @return {X64WordArray} The clone.
   *
   * @example
   *
   *     var clone = x64WordArray.clone();
   */
  clone() {
    const clone = super.clone.call(this);

    // Clone "words" array
    clone.words = this.words.slice(0);
    const { words } = clone;

    // Clone each X64Word object
    const wordsLength = words.length;
    for (let i = 0; i < wordsLength; i += 1) {
      words[i] = words[i].clone();
    }

    return clone;
  }
}

const parseLoop = (base64Str, base64StrLength, reverseMap) => {
  const words = [];
  let nBytes = 0;
  for (let i = 0; i < base64StrLength; i += 1) {
    if (i % 4) {
      const bits1 = reverseMap[base64Str.charCodeAt(i - 1)] << ((i % 4) * 2);
      const bits2 = reverseMap[base64Str.charCodeAt(i)] >>> (6 - (i % 4) * 2);
      const bitsCombined = bits1 | bits2;
      words[nBytes >>> 2] |= bitsCombined << (24 - (nBytes % 4) * 8);
      nBytes += 1;
    }
  }
  return WordArray.create(words, nBytes);
};

/**
 * Base64 encoding strategy.
 */
const Base64 = {
  /**
   * Converts a word array to a Base64 string.
   *
   * @param {WordArray} wordArray The word array.
   *
   * @return {string} The Base64 string.
   *
   * @static
   *
   * @example
   *
   *     const base64String = CryptoJS.enc.Base64.stringify(wordArray);
   */
  stringify(wordArray) {
    // Shortcuts
    const { words, sigBytes } = wordArray;
    const map = this._map;

    // Clamp excess bits
    wordArray.clamp();

    // Convert
    const base64Chars = [];
    for (let i = 0; i < sigBytes; i += 3) {
      const byte1 = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
      const byte2 = (words[(i + 1) >>> 2] >>> (24 - ((i + 1) % 4) * 8)) & 0xff;
      const byte3 = (words[(i + 2) >>> 2] >>> (24 - ((i + 2) % 4) * 8)) & 0xff;

      const triplet = (byte1 << 16) | (byte2 << 8) | byte3;

      for (let j = 0; (j < 4) && (i + j * 0.75 < sigBytes); j += 1) {
        base64Chars.push(map.charAt((triplet >>> (6 * (3 - j))) & 0x3f));
      }
    }

    // Add padding
    const paddingChar = map.charAt(64);
    if (paddingChar) {
      while (base64Chars.length % 4) {
        base64Chars.push(paddingChar);
      }
    }

    return base64Chars.join('');
  },

  /**
   * Converts a Base64 string to a word array.
   *
   * @param {string} base64Str The Base64 string.
   *
   * @return {WordArray} The word array.
   *
   * @static
   *
   * @example
   *
   *     const wordArray = CryptoJS.enc.Base64.parse(base64String);
   */
  parse(base64Str) {
    // Shortcuts
    let base64StrLength = base64Str.length;
    const map = this._map;
    let reverseMap = this._reverseMap;

    if (!reverseMap) {
      this._reverseMap = [];
      reverseMap = this._reverseMap;
      for (let j = 0; j < map.length; j += 1) {
        reverseMap[map.charCodeAt(j)] = j;
      }
    }

    // Ignore padding
    const paddingChar = map.charAt(64);
    if (paddingChar) {
      const paddingIndex = base64Str.indexOf(paddingChar);
      if (paddingIndex !== -1) {
        base64StrLength = paddingIndex;
      }
    }

    // Convert
    return parseLoop(base64Str, base64StrLength, reverseMap);
  },

  _map: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=',
};

// Constants table
const T$1 = [];

// Compute constants
for (let i = 0; i < 64; i += 1) {
  T$1[i] = (Math.abs(Math.sin(i + 1)) * 0x100000000) | 0;
}

const FF = (a, b, c, d, x, s, t) => {
  const n = a + ((b & c) | (~b & d)) + x + t;
  return ((n << s) | (n >>> (32 - s))) + b;
};

const GG = (a, b, c, d, x, s, t) => {
  const n = a + ((b & d) | (c & ~d)) + x + t;
  return ((n << s) | (n >>> (32 - s))) + b;
};

const HH = (a, b, c, d, x, s, t) => {
  const n = a + (b ^ c ^ d) + x + t;
  return ((n << s) | (n >>> (32 - s))) + b;
};

const II = (a, b, c, d, x, s, t) => {
  const n = a + (c ^ (b | ~d)) + x + t;
  return ((n << s) | (n >>> (32 - s))) + b;
};

/**
 * MD5 hash algorithm.
 */
class MD5Algo extends Hasher {
  _doReset() {
    this._hash = new WordArray([
      0x67452301,
      0xefcdab89,
      0x98badcfe,
      0x10325476,
    ]);
  }

  _doProcessBlock(M, offset) {
    const _M = M;

    // Swap endian
    for (let i = 0; i < 16; i += 1) {
      // Shortcuts
      const offset_i = offset + i;
      const M_offset_i = M[offset_i];

      _M[offset_i] = (
        (((M_offset_i << 8) | (M_offset_i >>> 24)) & 0x00ff00ff)
          | (((M_offset_i << 24) | (M_offset_i >>> 8)) & 0xff00ff00)
      );
    }

    // Shortcuts
    const H = this._hash.words;

    const M_offset_0 = _M[offset + 0];
    const M_offset_1 = _M[offset + 1];
    const M_offset_2 = _M[offset + 2];
    const M_offset_3 = _M[offset + 3];
    const M_offset_4 = _M[offset + 4];
    const M_offset_5 = _M[offset + 5];
    const M_offset_6 = _M[offset + 6];
    const M_offset_7 = _M[offset + 7];
    const M_offset_8 = _M[offset + 8];
    const M_offset_9 = _M[offset + 9];
    const M_offset_10 = _M[offset + 10];
    const M_offset_11 = _M[offset + 11];
    const M_offset_12 = _M[offset + 12];
    const M_offset_13 = _M[offset + 13];
    const M_offset_14 = _M[offset + 14];
    const M_offset_15 = _M[offset + 15];

    // Working varialbes
    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];

    // Computation
    a = FF(a, b, c, d, M_offset_0, 7, T$1[0]);
    d = FF(d, a, b, c, M_offset_1, 12, T$1[1]);
    c = FF(c, d, a, b, M_offset_2, 17, T$1[2]);
    b = FF(b, c, d, a, M_offset_3, 22, T$1[3]);
    a = FF(a, b, c, d, M_offset_4, 7, T$1[4]);
    d = FF(d, a, b, c, M_offset_5, 12, T$1[5]);
    c = FF(c, d, a, b, M_offset_6, 17, T$1[6]);
    b = FF(b, c, d, a, M_offset_7, 22, T$1[7]);
    a = FF(a, b, c, d, M_offset_8, 7, T$1[8]);
    d = FF(d, a, b, c, M_offset_9, 12, T$1[9]);
    c = FF(c, d, a, b, M_offset_10, 17, T$1[10]);
    b = FF(b, c, d, a, M_offset_11, 22, T$1[11]);
    a = FF(a, b, c, d, M_offset_12, 7, T$1[12]);
    d = FF(d, a, b, c, M_offset_13, 12, T$1[13]);
    c = FF(c, d, a, b, M_offset_14, 17, T$1[14]);
    b = FF(b, c, d, a, M_offset_15, 22, T$1[15]);

    a = GG(a, b, c, d, M_offset_1, 5, T$1[16]);
    d = GG(d, a, b, c, M_offset_6, 9, T$1[17]);
    c = GG(c, d, a, b, M_offset_11, 14, T$1[18]);
    b = GG(b, c, d, a, M_offset_0, 20, T$1[19]);
    a = GG(a, b, c, d, M_offset_5, 5, T$1[20]);
    d = GG(d, a, b, c, M_offset_10, 9, T$1[21]);
    c = GG(c, d, a, b, M_offset_15, 14, T$1[22]);
    b = GG(b, c, d, a, M_offset_4, 20, T$1[23]);
    a = GG(a, b, c, d, M_offset_9, 5, T$1[24]);
    d = GG(d, a, b, c, M_offset_14, 9, T$1[25]);
    c = GG(c, d, a, b, M_offset_3, 14, T$1[26]);
    b = GG(b, c, d, a, M_offset_8, 20, T$1[27]);
    a = GG(a, b, c, d, M_offset_13, 5, T$1[28]);
    d = GG(d, a, b, c, M_offset_2, 9, T$1[29]);
    c = GG(c, d, a, b, M_offset_7, 14, T$1[30]);
    b = GG(b, c, d, a, M_offset_12, 20, T$1[31]);

    a = HH(a, b, c, d, M_offset_5, 4, T$1[32]);
    d = HH(d, a, b, c, M_offset_8, 11, T$1[33]);
    c = HH(c, d, a, b, M_offset_11, 16, T$1[34]);
    b = HH(b, c, d, a, M_offset_14, 23, T$1[35]);
    a = HH(a, b, c, d, M_offset_1, 4, T$1[36]);
    d = HH(d, a, b, c, M_offset_4, 11, T$1[37]);
    c = HH(c, d, a, b, M_offset_7, 16, T$1[38]);
    b = HH(b, c, d, a, M_offset_10, 23, T$1[39]);
    a = HH(a, b, c, d, M_offset_13, 4, T$1[40]);
    d = HH(d, a, b, c, M_offset_0, 11, T$1[41]);
    c = HH(c, d, a, b, M_offset_3, 16, T$1[42]);
    b = HH(b, c, d, a, M_offset_6, 23, T$1[43]);
    a = HH(a, b, c, d, M_offset_9, 4, T$1[44]);
    d = HH(d, a, b, c, M_offset_12, 11, T$1[45]);
    c = HH(c, d, a, b, M_offset_15, 16, T$1[46]);
    b = HH(b, c, d, a, M_offset_2, 23, T$1[47]);

    a = II(a, b, c, d, M_offset_0, 6, T$1[48]);
    d = II(d, a, b, c, M_offset_7, 10, T$1[49]);
    c = II(c, d, a, b, M_offset_14, 15, T$1[50]);
    b = II(b, c, d, a, M_offset_5, 21, T$1[51]);
    a = II(a, b, c, d, M_offset_12, 6, T$1[52]);
    d = II(d, a, b, c, M_offset_3, 10, T$1[53]);
    c = II(c, d, a, b, M_offset_10, 15, T$1[54]);
    b = II(b, c, d, a, M_offset_1, 21, T$1[55]);
    a = II(a, b, c, d, M_offset_8, 6, T$1[56]);
    d = II(d, a, b, c, M_offset_15, 10, T$1[57]);
    c = II(c, d, a, b, M_offset_6, 15, T$1[58]);
    b = II(b, c, d, a, M_offset_13, 21, T$1[59]);
    a = II(a, b, c, d, M_offset_4, 6, T$1[60]);
    d = II(d, a, b, c, M_offset_11, 10, T$1[61]);
    c = II(c, d, a, b, M_offset_2, 15, T$1[62]);
    b = II(b, c, d, a, M_offset_9, 21, T$1[63]);

    // Intermediate hash value
    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
  }
  /* eslint-ensable no-param-reassign */

  _doFinalize() {
    // Shortcuts
    const data = this._data;
    const dataWords = data.words;

    const nBitsTotal = this._nDataBytes * 8;
    const nBitsLeft = data.sigBytes * 8;

    // Add padding
    dataWords[nBitsLeft >>> 5] |= 0x80 << (24 - (nBitsLeft % 32));

    const nBitsTotalH = Math.floor(nBitsTotal / 0x100000000);
    const nBitsTotalL = nBitsTotal;
    dataWords[(((nBitsLeft + 64) >>> 9) << 4) + 15] = (
      (((nBitsTotalH << 8) | (nBitsTotalH >>> 24)) & 0x00ff00ff)
        | (((nBitsTotalH << 24) | (nBitsTotalH >>> 8)) & 0xff00ff00)
    );
    dataWords[(((nBitsLeft + 64) >>> 9) << 4) + 14] = (
      (((nBitsTotalL << 8) | (nBitsTotalL >>> 24)) & 0x00ff00ff)
        | (((nBitsTotalL << 24) | (nBitsTotalL >>> 8)) & 0xff00ff00)
    );

    data.sigBytes = (dataWords.length + 1) * 4;

    // Hash final blocks
    this._process();

    // Shortcuts
    const hash = this._hash;
    const H = hash.words;

    // Swap endian
    for (let i = 0; i < 4; i += 1) {
      // Shortcut
      const H_i = H[i];

      H[i] = (((H_i << 8) | (H_i >>> 24)) & 0x00ff00ff)
        | (((H_i << 24) | (H_i >>> 8)) & 0xff00ff00);
    }

    // Return final computed hash
    return hash;
  }

  clone() {
    const clone = super.clone.call(this);
    clone._hash = this._hash.clone();

    return clone;
  }
}

/**
 * Shortcut function to the hasher's object interface.
 *
 * @param {WordArray|string} message The message to hash.
 *
 * @return {WordArray} The hash.
 *
 * @static
 *
 * @example
 *
 *     var hash = CryptoJS.MD5('message');
 *     var hash = CryptoJS.MD5(wordArray);
 */
const MD5 = Hasher._createHelper(MD5Algo);

/**
 * Shortcut function to the HMAC's object interface.
 *
 * @param {WordArray|string} message The message to hash.
 * @param {WordArray|string} key The secret key.
 *
 * @return {WordArray} The HMAC.
 *
 * @static
 *
 * @example
 *
 *     var hmac = CryptoJS.HmacMD5(message, key);
 */
const HmacMD5 = Hasher._createHmacHelper(MD5Algo);

/**
 * This key derivation function is meant to conform with EVP_BytesToKey.
 * www.openssl.org/docs/crypto/EVP_BytesToKey.html
 */
class EvpKDFAlgo extends Base {
  /**
   * Initializes a newly created key derivation function.
   *
   * @param {Object} cfg (Optional) The configuration options to use for the derivation.
   *
   * @example
   *
   *     const kdf = CryptoJS.algo.EvpKDF.create();
   *     const kdf = CryptoJS.algo.EvpKDF.create({ keySize: 8 });
   *     const kdf = CryptoJS.algo.EvpKDF.create({ keySize: 8, iterations: 1000 });
   */
  constructor(cfg) {
    super();

    /**
     * Configuration options.
     *
     * @property {number} keySize The key size in words to generate. Default: 4 (128 bits)
     * @property {Hasher} hasher The hash algorithm to use. Default: MD5
     * @property {number} iterations The number of iterations to perform. Default: 1
     */
    this.cfg = Object.assign(
      new Base(),
      {
        keySize: 128 / 32,
        hasher: MD5Algo,
        iterations: 1,
      },
      cfg,
    );
  }

  /**
   * Derives a key from a password.
   *
   * @param {WordArray|string} password The password.
   * @param {WordArray|string} salt A salt.
   *
   * @return {WordArray} The derived key.
   *
   * @example
   *
   *     const key = kdf.compute(password, salt);
   */
  compute(password, salt) {
    let block;

    // Shortcut
    const { cfg } = this;

    // Init hasher
    const hasher = cfg.hasher.create();

    // Initial values
    const derivedKey = WordArray.create();

    // Shortcuts
    const derivedKeyWords = derivedKey.words;
    const { keySize, iterations } = cfg;

    // Generate key
    while (derivedKeyWords.length < keySize) {
      if (block) {
        hasher.update(block);
      }
      block = hasher.update(password).finalize(salt);
      hasher.reset();

      // Iterations
      for (let i = 1; i < iterations; i += 1) {
        block = hasher.finalize(block);
        hasher.reset();
      }

      derivedKey.concat(block);
    }
    derivedKey.sigBytes = keySize * 4;

    return derivedKey;
  }
}

/**
 * Derives a key from a password.
 *
 * @param {WordArray|string} password The password.
 * @param {WordArray|string} salt A salt.
 * @param {Object} cfg (Optional) The configuration options to use for this computation.
 *
 * @return {WordArray} The derived key.
 *
 * @static
 *
 * @example
 *
 *     var key = CryptoJS.EvpKDF(password, salt);
 *     var key = CryptoJS.EvpKDF(password, salt, { keySize: 8 });
 *     var key = CryptoJS.EvpKDF(password, salt, { keySize: 8, iterations: 1000 });
 */
const EvpKDF = (password, salt, cfg) => EvpKDFAlgo.create(cfg).compute(password, salt);

/* eslint-disable no-use-before-define */

/**
 * Abstract base cipher template.
 *
 * @property {number} keySize This cipher's key size. Default: 4 (128 bits)
 * @property {number} ivSize This cipher's IV size. Default: 4 (128 bits)
 * @property {number} _ENC_XFORM_MODE A constant representing encryption mode.
 * @property {number} _DEC_XFORM_MODE A constant representing decryption mode.
 */
class Cipher extends BufferedBlockAlgorithm {
  /**
   * Initializes a newly created cipher.
   *
   * @param {number} xformMode Either the encryption or decryption transormation mode constant.
   * @param {WordArray} key The key.
   * @param {Object} cfg (Optional) The configuration options to use for this operation.
   *
   * @example
   *
   *     const cipher = CryptoJS.algo.AES.create(
   *       CryptoJS.algo.AES._ENC_XFORM_MODE, keyWordArray, { iv: ivWordArray }
   *     );
   */
  constructor(xformMode, key, cfg) {
    super();

    /**
     * Configuration options.
     *
     * @property {WordArray} iv The IV to use for this operation.
     */
    this.cfg = Object.assign(new Base(), cfg);

    // Store transform mode and key
    this._xformMode = xformMode;
    this._key = key;

    // Set initial values
    this.reset();
  }

  /**
   * Creates this cipher in encryption mode.
   *
   * @param {WordArray} key The key.
   * @param {Object} cfg (Optional) The configuration options to use for this operation.
   *
   * @return {Cipher} A cipher instance.
   *
   * @static
   *
   * @example
   *
   *     const cipher = CryptoJS.algo.AES.createEncryptor(keyWordArray, { iv: ivWordArray });
   */
  static createEncryptor(key, cfg) {
    return this.create(this._ENC_XFORM_MODE, key, cfg);
  }

  /**
   * Creates this cipher in decryption mode.
   *
   * @param {WordArray} key The key.
   * @param {Object} cfg (Optional) The configuration options to use for this operation.
   *
   * @return {Cipher} A cipher instance.
   *
   * @static
   *
   * @example
   *
   *     const cipher = CryptoJS.algo.AES.createDecryptor(keyWordArray, { iv: ivWordArray });
   */
  static createDecryptor(key, cfg) {
    return this.create(this._DEC_XFORM_MODE, key, cfg);
  }

  /**
   * Creates shortcut functions to a cipher's object interface.
   *
   * @param {Cipher} cipher The cipher to create a helper for.
   *
   * @return {Object} An object with encrypt and decrypt shortcut functions.
   *
   * @static
   *
   * @example
   *
   *     const AES = CryptoJS.lib.Cipher._createHelper(CryptoJS.algo.AES);
   */
  static _createHelper(SubCipher) {
    const selectCipherStrategy = (key) => {
      if (typeof key === 'string') {
        return PasswordBasedCipher;
      }
      return SerializableCipher;
    };

    return {
      encrypt(message, key, cfg) {
        return selectCipherStrategy(key).encrypt(SubCipher, message, key, cfg);
      },

      decrypt(ciphertext, key, cfg) {
        return selectCipherStrategy(key).decrypt(SubCipher, ciphertext, key, cfg);
      },
    };
  }

  /**
   * Resets this cipher to its initial state.
   *
   * @example
   *
   *     cipher.reset();
   */
  reset() {
    // Reset data buffer
    super.reset.call(this);

    // Perform concrete-cipher logic
    this._doReset();
  }

  /**
   * Adds data to be encrypted or decrypted.
   *
   * @param {WordArray|string} dataUpdate The data to encrypt or decrypt.
   *
   * @return {WordArray} The data after processing.
   *
   * @example
   *
   *     const encrypted = cipher.process('data');
   *     const encrypted = cipher.process(wordArray);
   */
  process(dataUpdate) {
    // Append
    this._append(dataUpdate);

    // Process available blocks
    return this._process();
  }

  /**
   * Finalizes the encryption or decryption process.
   * Note that the finalize operation is effectively a destructive, read-once operation.
   *
   * @param {WordArray|string} dataUpdate The final data to encrypt or decrypt.
   *
   * @return {WordArray} The data after final processing.
   *
   * @example
   *
   *     const encrypted = cipher.finalize();
   *     const encrypted = cipher.finalize('data');
   *     const encrypted = cipher.finalize(wordArray);
   */
  finalize(dataUpdate) {
    // Final data update
    if (dataUpdate) {
      this._append(dataUpdate);
    }

    // Perform concrete-cipher logic
    const finalProcessedData = this._doFinalize();

    return finalProcessedData;
  }
}
Cipher._ENC_XFORM_MODE = 1;
Cipher._DEC_XFORM_MODE = 2;
Cipher.keySize = 128 / 32;
Cipher.ivSize = 128 / 32;

/**
 * Abstract base stream cipher template.
 *
 * @property {number} blockSize
 *
 *     The number of 32-bit words this cipher operates on. Default: 1 (32 bits)
 */
class StreamCipher extends Cipher {
  constructor(...args) {
    super(...args);

    this.blockSize = 1;
  }

  _doFinalize() {
    // Process partial blocks
    const finalProcessedBlocks = this._process(!!'flush');

    return finalProcessedBlocks;
  }
}

/**
 * Abstract base block cipher mode template.
 */
class BlockCipherMode extends Base {
  /**
   * Initializes a newly created mode.
   *
   * @param {Cipher} cipher A block cipher instance.
   * @param {Array} iv The IV words.
   *
   * @example
   *
   *     const mode = CryptoJS.mode.CBC.Encryptor.create(cipher, iv.words);
   */
  constructor(cipher, iv) {
    super();

    this._cipher = cipher;
    this._iv = iv;
  }

  /**
   * Creates this mode for encryption.
   *
   * @param {Cipher} cipher A block cipher instance.
   * @param {Array} iv The IV words.
   *
   * @static
   *
   * @example
   *
   *     const mode = CryptoJS.mode.CBC.createEncryptor(cipher, iv.words);
   */
  static createEncryptor(cipher, iv) {
    return this.Encryptor.create(cipher, iv);
  }

  /**
   * Creates this mode for decryption.
   *
   * @param {Cipher} cipher A block cipher instance.
   * @param {Array} iv The IV words.
   *
   * @static
   *
   * @example
   *
   *     const mode = CryptoJS.mode.CBC.createDecryptor(cipher, iv.words);
   */
  static createDecryptor(cipher, iv) {
    return this.Decryptor.create(cipher, iv);
  }
}

function xorBlock(words, offset, blockSize) {
  const _words = words;
  let block;

  // Shortcut
  const iv = this._iv;

  // Choose mixing block
  if (iv) {
    block = iv;

    // Remove IV for subsequent blocks
    this._iv = undefined;
  } else {
    block = this._prevBlock;
  }

  // XOR blocks
  for (let i = 0; i < blockSize; i += 1) {
    _words[offset + i] ^= block[i];
  }
}

/**
 * Cipher Block Chaining mode.
 */

/**
 * Abstract base CBC mode.
 */
class CBC extends BlockCipherMode {
}
/**
 * CBC encryptor.
 */
CBC.Encryptor = class extends CBC {
  /**
   * Processes the data block at offset.
   *
   * @param {Array} words The data words to operate on.
   * @param {number} offset The offset where the block starts.
   *
   * @example
   *
   *     mode.processBlock(data.words, offset);
   */
  processBlock(words, offset) {
    // Shortcuts
    const cipher = this._cipher;
    const { blockSize } = cipher;

    // XOR and encrypt
    xorBlock.call(this, words, offset, blockSize);
    cipher.encryptBlock(words, offset);

    // Remember this block to use with next block
    this._prevBlock = words.slice(offset, offset + blockSize);
  }
};
/**
 * CBC decryptor.
 */
CBC.Decryptor = class extends CBC {
  /**
   * Processes the data block at offset.
   *
   * @param {Array} words The data words to operate on.
   * @param {number} offset The offset where the block starts.
   *
   * @example
   *
   *     mode.processBlock(data.words, offset);
   */
  processBlock(words, offset) {
    // Shortcuts
    const cipher = this._cipher;
    const { blockSize } = cipher;

    // Remember this block to use with next block
    const thisBlock = words.slice(offset, offset + blockSize);

    // Decrypt and XOR
    cipher.decryptBlock(words, offset);
    xorBlock.call(this, words, offset, blockSize);

    // This block becomes the previous block
    this._prevBlock = thisBlock;
  }
};

/**
 * PKCS #5/7 padding strategy.
 */
const Pkcs7 = {
  /**
   * Pads data using the algorithm defined in PKCS #5/7.
   *
   * @param {WordArray} data The data to pad.
   * @param {number} blockSize The multiple that the data should be padded to.
   *
   * @static
   *
   * @example
   *
   *     CryptoJS.pad.Pkcs7.pad(wordArray, 4);
   */
  pad(data, blockSize) {
    // Shortcut
    const blockSizeBytes = blockSize * 4;

    // Count padding bytes
    const nPaddingBytes = blockSizeBytes - (data.sigBytes % blockSizeBytes);

    // Create padding word
    const paddingWord = (nPaddingBytes << 24)
      | (nPaddingBytes << 16)
      | (nPaddingBytes << 8)
      | nPaddingBytes;

    // Create padding
    const paddingWords = [];
    for (let i = 0; i < nPaddingBytes; i += 4) {
      paddingWords.push(paddingWord);
    }
    const padding = WordArray.create(paddingWords, nPaddingBytes);

    // Add padding
    data.concat(padding);
  },

  /**
   * Unpads data that had been padded using the algorithm defined in PKCS #5/7.
   *
   * @param {WordArray} data The data to unpad.
   *
   * @static
   *
   * @example
   *
   *     CryptoJS.pad.Pkcs7.unpad(wordArray);
   */
  unpad(data) {
    const _data = data;

    // Get number of padding bytes from last byte
    const nPaddingBytes = _data.words[(_data.sigBytes - 1) >>> 2] & 0xff;

    // Remove padding
    _data.sigBytes -= nPaddingBytes;
  },
};

/**
 * Abstract base block cipher template.
 *
 * @property {number} blockSize
 *
 *    The number of 32-bit words this cipher operates on. Default: 4 (128 bits)
 */
class BlockCipher extends Cipher {
  constructor(xformMode, key, cfg) {
    /**
     * Configuration options.
     *
     * @property {Mode} mode The block mode to use. Default: CBC
     * @property {Padding} padding The padding strategy to use. Default: Pkcs7
     */
    super(xformMode, key, Object.assign(
      {
        mode: CBC,
        padding: Pkcs7,
      },
      cfg,
    ));

    this.blockSize = 128 / 32;
  }

  reset() {
    let modeCreator;

    // Reset cipher
    super.reset.call(this);

    // Shortcuts
    const { cfg } = this;
    const { iv, mode } = cfg;

    // Reset block mode
    if (this._xformMode === this.constructor._ENC_XFORM_MODE) {
      modeCreator = mode.createEncryptor;
    } else /* if (this._xformMode == this._DEC_XFORM_MODE) */ {
      modeCreator = mode.createDecryptor;
      // Keep at least one block in the buffer for unpadding
      this._minBufferSize = 1;
    }

    this._mode = modeCreator.call(mode, this, iv && iv.words);
    this._mode.__creator = modeCreator;
  }

  _doProcessBlock(words, offset) {
    this._mode.processBlock(words, offset);
  }

  _doFinalize() {
    let finalProcessedBlocks;

    // Shortcut
    const { padding } = this.cfg;

    // Finalize
    if (this._xformMode === this.constructor._ENC_XFORM_MODE) {
      // Pad data
      padding.pad(this._data, this.blockSize);

      // Process final blocks
      finalProcessedBlocks = this._process(!!'flush');
    } else /* if (this._xformMode == this._DEC_XFORM_MODE) */ {
      // Process final blocks
      finalProcessedBlocks = this._process(!!'flush');

      // Unpad data
      padding.unpad(finalProcessedBlocks);
    }

    return finalProcessedBlocks;
  }
}

/**
 * A collection of cipher parameters.
 *
 * @property {WordArray} ciphertext The raw ciphertext.
 * @property {WordArray} key The key to this ciphertext.
 * @property {WordArray} iv The IV used in the ciphering operation.
 * @property {WordArray} salt The salt used with a key derivation function.
 * @property {Cipher} algorithm The cipher algorithm.
 * @property {Mode} mode The block mode used in the ciphering operation.
 * @property {Padding} padding The padding scheme used in the ciphering operation.
 * @property {number} blockSize The block size of the cipher.
 * @property {Format} formatter
 *    The default formatting strategy to convert this cipher params object to a string.
 */
class CipherParams extends Base {
  /**
   * Initializes a newly created cipher params object.
   *
   * @param {Object} cipherParams An object with any of the possible cipher parameters.
   *
   * @example
   *
   *     var cipherParams = CryptoJS.lib.CipherParams.create({
   *         ciphertext: ciphertextWordArray,
   *         key: keyWordArray,
   *         iv: ivWordArray,
   *         salt: saltWordArray,
   *         algorithm: CryptoJS.algo.AES,
   *         mode: CryptoJS.mode.CBC,
   *         padding: CryptoJS.pad.PKCS7,
   *         blockSize: 4,
   *         formatter: CryptoJS.format.OpenSSL
   *     });
   */
  constructor(cipherParams) {
    super();

    this.mixIn(cipherParams);
  }

  /**
   * Converts this cipher params object to a string.
   *
   * @param {Format} formatter (Optional) The formatting strategy to use.
   *
   * @return {string} The stringified cipher params.
   *
   * @throws Error If neither the formatter nor the default formatter is set.
   *
   * @example
   *
   *     var string = cipherParams + '';
   *     var string = cipherParams.toString();
   *     var string = cipherParams.toString(CryptoJS.format.OpenSSL);
   */
  toString(formatter) {
    return (formatter || this.formatter).stringify(this);
  }
}

/**
 * OpenSSL formatting strategy.
 */
const OpenSSLFormatter = {
  /**
   * Converts a cipher params object to an OpenSSL-compatible string.
   *
   * @param {CipherParams} cipherParams The cipher params object.
   *
   * @return {string} The OpenSSL-compatible string.
   *
   * @static
   *
   * @example
   *
   *     var openSSLString = CryptoJS.format.OpenSSL.stringify(cipherParams);
   */
  stringify(cipherParams) {
    let wordArray;

    // Shortcuts
    const { ciphertext, salt } = cipherParams;

    // Format
    if (salt) {
      wordArray = WordArray.create([0x53616c74, 0x65645f5f]).concat(salt).concat(ciphertext);
    } else {
      wordArray = ciphertext;
    }

    return wordArray.toString(Base64);
  },

  /**
   * Converts an OpenSSL-compatible string to a cipher params object.
   *
   * @param {string} openSSLStr The OpenSSL-compatible string.
   *
   * @return {CipherParams} The cipher params object.
   *
   * @static
   *
   * @example
   *
   *     var cipherParams = CryptoJS.format.OpenSSL.parse(openSSLString);
   */
  parse(openSSLStr) {
    let salt;

    // Parse base64
    const ciphertext = Base64.parse(openSSLStr);

    // Shortcut
    const ciphertextWords = ciphertext.words;

    // Test for salt
    if (ciphertextWords[0] === 0x53616c74 && ciphertextWords[1] === 0x65645f5f) {
      // Extract salt
      salt = WordArray.create(ciphertextWords.slice(2, 4));

      // Remove salt from ciphertext
      ciphertextWords.splice(0, 4);
      ciphertext.sigBytes -= 16;
    }

    return CipherParams.create({ ciphertext, salt });
  },
};

/**
 * A cipher wrapper that returns ciphertext as a serializable cipher params object.
 */
class SerializableCipher extends Base {
  /**
   * Encrypts a message.
   *
   * @param {Cipher} cipher The cipher algorithm to use.
   * @param {WordArray|string} message The message to encrypt.
   * @param {WordArray} key The key.
   * @param {Object} cfg (Optional) The configuration options to use for this operation.
   *
   * @return {CipherParams} A cipher params object.
   *
   * @static
   *
   * @example
   *
   *     var ciphertextParams = CryptoJS.lib.SerializableCipher
   *       .encrypt(CryptoJS.algo.AES, message, key);
   *     var ciphertextParams = CryptoJS.lib.SerializableCipher
   *       .encrypt(CryptoJS.algo.AES, message, key, { iv: iv });
   *     var ciphertextParams = CryptoJS.lib.SerializableCipher
   *       .encrypt(CryptoJS.algo.AES, message, key, { iv: iv, format: CryptoJS.format.OpenSSL });
   */
  static encrypt(cipher, message, key, cfg) {
    // Apply config defaults
    const _cfg = Object.assign(new Base(), this.cfg, cfg);

    // Encrypt
    const encryptor = cipher.createEncryptor(key, _cfg);
    const ciphertext = encryptor.finalize(message);

    // Shortcut
    const cipherCfg = encryptor.cfg;

    // Create and return serializable cipher params
    return CipherParams.create({
      ciphertext,
      key,
      iv: cipherCfg.iv,
      algorithm: cipher,
      mode: cipherCfg.mode,
      padding: cipherCfg.padding,
      blockSize: encryptor.blockSize,
      formatter: _cfg.format,
    });
  }

  /**
   * Decrypts serialized ciphertext.
   *
   * @param {Cipher} cipher The cipher algorithm to use.
   * @param {CipherParams|string} ciphertext The ciphertext to decrypt.
   * @param {WordArray} key The key.
   * @param {Object} cfg (Optional) The configuration options to use for this operation.
   *
   * @return {WordArray} The plaintext.
   *
   * @static
   *
   * @example
   *
   *     var plaintext = CryptoJS.lib.SerializableCipher
   *       .decrypt(CryptoJS.algo.AES, formattedCiphertext, key,
   *         { iv: iv, format: CryptoJS.format.OpenSSL });
   *     var plaintext = CryptoJS.lib.SerializableCipher
   *       .decrypt(CryptoJS.algo.AES, ciphertextParams, key,
   *         { iv: iv, format: CryptoJS.format.OpenSSL });
   */
  static decrypt(cipher, ciphertext, key, cfg) {
    let _ciphertext = ciphertext;

    // Apply config defaults
    const _cfg = Object.assign(new Base(), this.cfg, cfg);

    // Convert string to CipherParams
    _ciphertext = this._parse(_ciphertext, _cfg.format);

    // Decrypt
    const plaintext = cipher.createDecryptor(key, _cfg).finalize(_ciphertext.ciphertext);

    return plaintext;
  }

  /**
   * Converts serialized ciphertext to CipherParams,
   * else assumed CipherParams already and returns ciphertext unchanged.
   *
   * @param {CipherParams|string} ciphertext The ciphertext.
   * @param {Formatter} format The formatting strategy to use to parse serialized ciphertext.
   *
   * @return {CipherParams} The unserialized ciphertext.
   *
   * @static
   *
   * @example
   *
   *     var ciphertextParams = CryptoJS.lib.SerializableCipher
   *       ._parse(ciphertextStringOrParams, format);
   */
  static _parse(ciphertext, format) {
    if (typeof ciphertext === 'string') {
      return format.parse(ciphertext, this);
    }
    return ciphertext;
  }
}
/**
 * Configuration options.
 *
 * @property {Formatter} format
 *
 *    The formatting strategy to convert cipher param objects to and from a string.
 *    Default: OpenSSL
 */
SerializableCipher.cfg = Object.assign(
  new Base(),
  { format: OpenSSLFormatter },
);

/**
 * OpenSSL key derivation function.
 */
const OpenSSLKdf = {
  /**
   * Derives a key and IV from a password.
   *
   * @param {string} password The password to derive from.
   * @param {number} keySize The size in words of the key to generate.
   * @param {number} ivSize The size in words of the IV to generate.
   * @param {WordArray|string} salt
   *     (Optional) A 64-bit salt to use. If omitted, a salt will be generated randomly.
   *
   * @return {CipherParams} A cipher params object with the key, IV, and salt.
   *
   * @static
   *
   * @example
   *
   *     var derivedParams = CryptoJS.kdf.OpenSSL.execute('Password', 256/32, 128/32);
   *     var derivedParams = CryptoJS.kdf.OpenSSL.execute('Password', 256/32, 128/32, 'saltsalt');
   */
  execute(password, keySize, ivSize, salt) {
    let _salt = salt;

    // Generate random salt
    if (!_salt) {
      _salt = WordArray.random(64 / 8);
    }

    // Derive key and IV
    const key = EvpKDFAlgo.create({ keySize: keySize + ivSize }).compute(password, _salt);

    // Separate key and IV
    const iv = WordArray.create(key.words.slice(keySize), ivSize * 4);
    key.sigBytes = keySize * 4;

    // Return params
    return CipherParams.create({ key, iv, salt: _salt });
  },
};

/**
 * A serializable cipher wrapper that derives the key from a password,
 * and returns ciphertext as a serializable cipher params object.
 */
class PasswordBasedCipher extends SerializableCipher {
  /**
   * Encrypts a message using a password.
   *
   * @param {Cipher} cipher The cipher algorithm to use.
   * @param {WordArray|string} message The message to encrypt.
   * @param {string} password The password.
   * @param {Object} cfg (Optional) The configuration options to use for this operation.
   *
   * @return {CipherParams} A cipher params object.
   *
   * @static
   *
   * @example
   *
   *     var ciphertextParams = CryptoJS.lib.PasswordBasedCipher
   *       .encrypt(CryptoJS.algo.AES, message, 'password');
   *     var ciphertextParams = CryptoJS.lib.PasswordBasedCipher
   *       .encrypt(CryptoJS.algo.AES, message, 'password', { format: CryptoJS.format.OpenSSL });
   */
  static encrypt(cipher, message, password, cfg) {
    // Apply config defaults
    const _cfg = Object.assign(new Base(), this.cfg, cfg);

    // Derive key and other params
    const derivedParams = _cfg.kdf.execute(password, cipher.keySize, cipher.ivSize);

    // Add IV to config
    _cfg.iv = derivedParams.iv;

    // Encrypt
    const ciphertext = SerializableCipher.encrypt
      .call(this, cipher, message, derivedParams.key, _cfg);

    // Mix in derived params
    ciphertext.mixIn(derivedParams);

    return ciphertext;
  }

  /**
   * Decrypts serialized ciphertext using a password.
   *
   * @param {Cipher} cipher The cipher algorithm to use.
   * @param {CipherParams|string} ciphertext The ciphertext to decrypt.
   * @param {string} password The password.
   * @param {Object} cfg (Optional) The configuration options to use for this operation.
   *
   * @return {WordArray} The plaintext.
   *
   * @static
   *
   * @example
   *
   *     var plaintext = CryptoJS.lib.PasswordBasedCipher
   *       .decrypt(CryptoJS.algo.AES, formattedCiphertext, 'password',
   *         { format: CryptoJS.format.OpenSSL });
   *     var plaintext = CryptoJS.lib.PasswordBasedCipher
   *       .decrypt(CryptoJS.algo.AES, ciphertextParams, 'password',
   *         { format: CryptoJS.format.OpenSSL });
   */
  static decrypt(cipher, ciphertext, password, cfg) {
    let _ciphertext = ciphertext;

    // Apply config defaults
    const _cfg = Object.assign(new Base(), this.cfg, cfg);

    // Convert string to CipherParams
    _ciphertext = this._parse(_ciphertext, _cfg.format);

    // Derive key and other params
    const derivedParams = _cfg.kdf
      .execute(password, cipher.keySize, cipher.ivSize, _ciphertext.salt);

    // Add IV to config
    _cfg.iv = derivedParams.iv;

    // Decrypt
    const plaintext = SerializableCipher.decrypt
      .call(this, cipher, _ciphertext, derivedParams.key, _cfg);

    return plaintext;
  }
}
/**
 * Configuration options.
 *
 * @property {KDF} kdf
 *     The key derivation function to use to generate a key and IV from a password.
 *     Default: OpenSSL
 */
PasswordBasedCipher.cfg = Object.assign(SerializableCipher.cfg, { kdf: OpenSSLKdf });

const swapEndian = word => ((word << 8) & 0xff00ff00) | ((word >>> 8) & 0x00ff00ff);

/**
 * UTF-16 BE encoding strategy.
 */
const Utf16BE = {
  /**
   * Converts a word array to a UTF-16 BE string.
   *
   * @param {WordArray} wordArray The word array.
   *
   * @return {string} The UTF-16 BE string.
   *
   * @static
   *
   * @example
   *
   *     const utf16String = CryptoJS.enc.Utf16.stringify(wordArray);
   */
  stringify(wordArray) {
    // Shortcuts
    const { words, sigBytes } = wordArray;

    // Convert
    const utf16Chars = [];
    for (let i = 0; i < sigBytes; i += 2) {
      const codePoint = (words[i >>> 2] >>> (16 - (i % 4) * 8)) & 0xffff;
      utf16Chars.push(String.fromCharCode(codePoint));
    }

    return utf16Chars.join('');
  },

  /**
   * Converts a UTF-16 BE string to a word array.
   *
   * @param {string} utf16Str The UTF-16 BE string.
   *
   * @return {WordArray} The word array.
   *
   * @static
   *
   * @example
   *
   *     const wordArray = CryptoJS.enc.Utf16.parse(utf16String);
   */
  parse(utf16Str) {
    // Shortcut
    const utf16StrLength = utf16Str.length;

    // Convert
    const words = [];
    for (let i = 0; i < utf16StrLength; i += 1) {
      words[i >>> 1] |= utf16Str.charCodeAt(i) << (16 - (i % 2) * 16);
    }

    return WordArray.create(words, utf16StrLength * 2);
  },
};
const Utf16 = Utf16BE;

/**
 * UTF-16 LE encoding strategy.
 */
const Utf16LE = {
  /**
   * Converts a word array to a UTF-16 LE string.
   *
   * @param {WordArray} wordArray The word array.
   *
   * @return {string} The UTF-16 LE string.
   *
   * @static
   *
   * @example
   *
   *     const utf16Str = CryptoJS.enc.Utf16LE.stringify(wordArray);
   */
  stringify(wordArray) {
    // Shortcuts
    const { words, sigBytes } = wordArray;

    // Convert
    const utf16Chars = [];
    for (let i = 0; i < sigBytes; i += 2) {
      const codePoint = swapEndian((words[i >>> 2] >>> (16 - (i % 4) * 8)) & 0xffff);
      utf16Chars.push(String.fromCharCode(codePoint));
    }

    return utf16Chars.join('');
  },

  /**
   * Converts a UTF-16 LE string to a word array.
   *
   * @param {string} utf16Str The UTF-16 LE string.
   *
   * @return {WordArray} The word array.
   *
   * @static
   *
   * @example
   *
   *     const wordArray = CryptoJS.enc.Utf16LE.parse(utf16Str);
   */
  parse(utf16Str) {
    // Shortcut
    const utf16StrLength = utf16Str.length;

    // Convert
    const words = [];
    for (let i = 0; i < utf16StrLength; i += 1) {
      words[i >>> 1] |= swapEndian(utf16Str.charCodeAt(i) << (16 - (i % 2) * 16));
    }

    return WordArray.create(words, utf16StrLength * 2);
  },
};

// Reusable object
const W$2 = [];

/**
 * SHA-1 hash algorithm.
 */
class SHA1Algo extends Hasher {
  _doReset() {
    this._hash = new WordArray([
      0x67452301,
      0xefcdab89,
      0x98badcfe,
      0x10325476,
      0xc3d2e1f0,
    ]);
  }

  _doProcessBlock(M, offset) {
    // Shortcut
    const H = this._hash.words;

    // Working variables
    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];

    // Computation
    for (let i = 0; i < 80; i += 1) {
      if (i < 16) {
        W$2[i] = M[offset + i] | 0;
      } else {
        const n = W$2[i - 3] ^ W$2[i - 8] ^ W$2[i - 14] ^ W$2[i - 16];
        W$2[i] = (n << 1) | (n >>> 31);
      }

      let t = ((a << 5) | (a >>> 27)) + e + W$2[i];
      if (i < 20) {
        t += ((b & c) | (~b & d)) + 0x5a827999;
      } else if (i < 40) {
        t += (b ^ c ^ d) + 0x6ed9eba1;
      } else if (i < 60) {
        t += ((b & c) | (b & d) | (c & d)) - 0x70e44324;
      } else /* if (i < 80) */ {
        t += (b ^ c ^ d) - 0x359d3e2a;
      }

      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }

    // Intermediate hash value
    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0;
  }

  _doFinalize() {
    // Shortcuts
    const data = this._data;
    const dataWords = data.words;

    const nBitsTotal = this._nDataBytes * 8;
    const nBitsLeft = data.sigBytes * 8;

    // Add padding
    dataWords[nBitsLeft >>> 5] |= 0x80 << (24 - (nBitsLeft % 32));
    dataWords[(((nBitsLeft + 64) >>> 9) << 4) + 14] = Math.floor(nBitsTotal / 0x100000000);
    dataWords[(((nBitsLeft + 64) >>> 9) << 4) + 15] = nBitsTotal;
    data.sigBytes = dataWords.length * 4;

    // Hash final blocks
    this._process();

    // Return final computed hash
    return this._hash;
  }

  clone() {
    const clone = super.clone.call(this);
    clone._hash = this._hash.clone();

    return clone;
  }
}

/**
 * Shortcut function to the hasher's object interface.
 *
 * @param {WordArray|string} message The message to hash.
 *
 * @return {WordArray} The hash.
 *
 * @static
 *
 * @example
 *
 *     var hash = CryptoJS.SHA1('message');
 *     var hash = CryptoJS.SHA1(wordArray);
 */
const SHA1 = Hasher._createHelper(SHA1Algo);

/**
 * Shortcut function to the HMAC's object interface.
 *
 * @param {WordArray|string} message The message to hash.
 * @param {WordArray|string} key The secret key.
 *
 * @return {WordArray} The HMAC.
 *
 * @static
 *
 * @example
 *
 *     var hmac = CryptoJS.HmacSHA1(message, key);
 */
const HmacSHA1 = Hasher._createHmacHelper(SHA1Algo);

// Initialization and round constants tables
const H = [];
const K$1 = [];

// Compute constants
const isPrime = (n) => {
  const sqrtN = Math.sqrt(n);
  for (let factor = 2; factor <= sqrtN; factor += 1) {
    if (!(n % factor)) {
      return false;
    }
  }

  return true;
};

const getFractionalBits = n => ((n - (n | 0)) * 0x100000000) | 0;

let n = 2;
let nPrime = 0;
while (nPrime < 64) {
  if (isPrime(n)) {
    if (nPrime < 8) {
      H[nPrime] = getFractionalBits(n ** (1 / 2));
    }
    K$1[nPrime] = getFractionalBits(n ** (1 / 3));

    nPrime += 1;
  }

  n += 1;
}

// Reusable object
const W$1 = [];

/**
 * SHA-256 hash algorithm.
 */
class SHA256Algo extends Hasher {
  _doReset() {
    this._hash = new WordArray(H.slice(0));
  }

  _doProcessBlock(M, offset) {
    // Shortcut
    const _H = this._hash.words;

    // Working variables
    let a = _H[0];
    let b = _H[1];
    let c = _H[2];
    let d = _H[3];
    let e = _H[4];
    let f = _H[5];
    let g = _H[6];
    let h = _H[7];

    // Computation
    for (let i = 0; i < 64; i += 1) {
      if (i < 16) {
        W$1[i] = M[offset + i] | 0;
      } else {
        const gamma0x = W$1[i - 15];
        const gamma0 = ((gamma0x << 25) | (gamma0x >>> 7))
          ^ ((gamma0x << 14) | (gamma0x >>> 18))
          ^ (gamma0x >>> 3);

        const gamma1x = W$1[i - 2];
        const gamma1 = ((gamma1x << 15) | (gamma1x >>> 17))
          ^ ((gamma1x << 13) | (gamma1x >>> 19))
          ^ (gamma1x >>> 10);

        W$1[i] = gamma0 + W$1[i - 7] + gamma1 + W$1[i - 16];
      }

      const ch = (e & f) ^ (~e & g);
      const maj = (a & b) ^ (a & c) ^ (b & c);

      const sigma0 = ((a << 30) | (a >>> 2)) ^ ((a << 19) | (a >>> 13)) ^ ((a << 10) | (a >>> 22));
      const sigma1 = ((e << 26) | (e >>> 6)) ^ ((e << 21) | (e >>> 11)) ^ ((e << 7) | (e >>> 25));

      const t1 = h + sigma1 + ch + K$1[i] + W$1[i];
      const t2 = sigma0 + maj;

      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }

    // Intermediate hash value
    _H[0] = (_H[0] + a) | 0;
    _H[1] = (_H[1] + b) | 0;
    _H[2] = (_H[2] + c) | 0;
    _H[3] = (_H[3] + d) | 0;
    _H[4] = (_H[4] + e) | 0;
    _H[5] = (_H[5] + f) | 0;
    _H[6] = (_H[6] + g) | 0;
    _H[7] = (_H[7] + h) | 0;
  }

  _doFinalize() {
    // Shortcuts
    const data = this._data;
    const dataWords = data.words;

    const nBitsTotal = this._nDataBytes * 8;
    const nBitsLeft = data.sigBytes * 8;

    // Add padding
    dataWords[nBitsLeft >>> 5] |= 0x80 << (24 - (nBitsLeft % 32));
    dataWords[(((nBitsLeft + 64) >>> 9) << 4) + 14] = Math.floor(nBitsTotal / 0x100000000);
    dataWords[(((nBitsLeft + 64) >>> 9) << 4) + 15] = nBitsTotal;
    data.sigBytes = dataWords.length * 4;

    // Hash final blocks
    this._process();

    // Return final computed hash
    return this._hash;
  }

  clone() {
    const clone = super.clone.call(this);
    clone._hash = this._hash.clone();

    return clone;
  }
}

/**
 * Shortcut function to the hasher's object interface.
 *
 * @param {WordArray|string} message The message to hash.
 *
 * @return {WordArray} The hash.
 *
 * @static
 *
 * @example
 *
 *     var hash = CryptoJS.SHA256('message');
 *     var hash = CryptoJS.SHA256(wordArray);
 */
const SHA256 = Hasher._createHelper(SHA256Algo);

/**
 * Shortcut function to the HMAC's object interface.
 *
 * @param {WordArray|string} message The message to hash.
 * @param {WordArray|string} key The secret key.
 *
 * @return {WordArray} The HMAC.
 *
 * @static
 *
 * @example
 *
 *     var hmac = CryptoJS.HmacSHA256(message, key);
 */
const HmacSHA256 = Hasher._createHmacHelper(SHA256Algo);

/**
 * SHA-224 hash algorithm.
 */
class SHA224Algo extends SHA256Algo {
  _doReset() {
    this._hash = new WordArray([
      0xc1059ed8,
      0x367cd507,
      0x3070dd17,
      0xf70e5939,
      0xffc00b31,
      0x68581511,
      0x64f98fa7,
      0xbefa4fa4,
    ]);
  }

  _doFinalize() {
    const hash = super._doFinalize.call(this);

    hash.sigBytes -= 4;

    return hash;
  }
}

/**
 * Shortcut function to the hasher's object interface.
 *
 * @param {WordArray|string} message The message to hash.
 *
 * @return {WordArray} The hash.
 *
 * @static
 *
 * @example
 *
 *     var hash = CryptoJS.SHA224('message');
 *     var hash = CryptoJS.SHA224(wordArray);
 */
const SHA224 = SHA256Algo._createHelper(SHA224Algo);

/**
 * Shortcut function to the HMAC's object interface.
 *
 * @param {WordArray|string} message The message to hash.
 * @param {WordArray|string} key The secret key.
 *
 * @return {WordArray} The HMAC.
 *
 * @static
 *
 * @example
 *
 *     var hmac = CryptoJS.HmacSHA224(message, key);
 */
const HmacSHA224 = SHA256Algo._createHmacHelper(SHA224Algo);

// Constants
const K = [
  new X64Word(0x428a2f98, 0xd728ae22),
  new X64Word(0x71374491, 0x23ef65cd),
  new X64Word(0xb5c0fbcf, 0xec4d3b2f),
  new X64Word(0xe9b5dba5, 0x8189dbbc),
  new X64Word(0x3956c25b, 0xf348b538),
  new X64Word(0x59f111f1, 0xb605d019),
  new X64Word(0x923f82a4, 0xaf194f9b),
  new X64Word(0xab1c5ed5, 0xda6d8118),
  new X64Word(0xd807aa98, 0xa3030242),
  new X64Word(0x12835b01, 0x45706fbe),
  new X64Word(0x243185be, 0x4ee4b28c),
  new X64Word(0x550c7dc3, 0xd5ffb4e2),
  new X64Word(0x72be5d74, 0xf27b896f),
  new X64Word(0x80deb1fe, 0x3b1696b1),
  new X64Word(0x9bdc06a7, 0x25c71235),
  new X64Word(0xc19bf174, 0xcf692694),
  new X64Word(0xe49b69c1, 0x9ef14ad2),
  new X64Word(0xefbe4786, 0x384f25e3),
  new X64Word(0x0fc19dc6, 0x8b8cd5b5),
  new X64Word(0x240ca1cc, 0x77ac9c65),
  new X64Word(0x2de92c6f, 0x592b0275),
  new X64Word(0x4a7484aa, 0x6ea6e483),
  new X64Word(0x5cb0a9dc, 0xbd41fbd4),
  new X64Word(0x76f988da, 0x831153b5),
  new X64Word(0x983e5152, 0xee66dfab),
  new X64Word(0xa831c66d, 0x2db43210),
  new X64Word(0xb00327c8, 0x98fb213f),
  new X64Word(0xbf597fc7, 0xbeef0ee4),
  new X64Word(0xc6e00bf3, 0x3da88fc2),
  new X64Word(0xd5a79147, 0x930aa725),
  new X64Word(0x06ca6351, 0xe003826f),
  new X64Word(0x14292967, 0x0a0e6e70),
  new X64Word(0x27b70a85, 0x46d22ffc),
  new X64Word(0x2e1b2138, 0x5c26c926),
  new X64Word(0x4d2c6dfc, 0x5ac42aed),
  new X64Word(0x53380d13, 0x9d95b3df),
  new X64Word(0x650a7354, 0x8baf63de),
  new X64Word(0x766a0abb, 0x3c77b2a8),
  new X64Word(0x81c2c92e, 0x47edaee6),
  new X64Word(0x92722c85, 0x1482353b),
  new X64Word(0xa2bfe8a1, 0x4cf10364),
  new X64Word(0xa81a664b, 0xbc423001),
  new X64Word(0xc24b8b70, 0xd0f89791),
  new X64Word(0xc76c51a3, 0x0654be30),
  new X64Word(0xd192e819, 0xd6ef5218),
  new X64Word(0xd6990624, 0x5565a910),
  new X64Word(0xf40e3585, 0x5771202a),
  new X64Word(0x106aa070, 0x32bbd1b8),
  new X64Word(0x19a4c116, 0xb8d2d0c8),
  new X64Word(0x1e376c08, 0x5141ab53),
  new X64Word(0x2748774c, 0xdf8eeb99),
  new X64Word(0x34b0bcb5, 0xe19b48a8),
  new X64Word(0x391c0cb3, 0xc5c95a63),
  new X64Word(0x4ed8aa4a, 0xe3418acb),
  new X64Word(0x5b9cca4f, 0x7763e373),
  new X64Word(0x682e6ff3, 0xd6b2b8a3),
  new X64Word(0x748f82ee, 0x5defb2fc),
  new X64Word(0x78a5636f, 0x43172f60),
  new X64Word(0x84c87814, 0xa1f0ab72),
  new X64Word(0x8cc70208, 0x1a6439ec),
  new X64Word(0x90befffa, 0x23631e28),
  new X64Word(0xa4506ceb, 0xde82bde9),
  new X64Word(0xbef9a3f7, 0xb2c67915),
  new X64Word(0xc67178f2, 0xe372532b),
  new X64Word(0xca273ece, 0xea26619c),
  new X64Word(0xd186b8c7, 0x21c0c207),
  new X64Word(0xeada7dd6, 0xcde0eb1e),
  new X64Word(0xf57d4f7f, 0xee6ed178),
  new X64Word(0x06f067aa, 0x72176fba),
  new X64Word(0x0a637dc5, 0xa2c898a6),
  new X64Word(0x113f9804, 0xbef90dae),
  new X64Word(0x1b710b35, 0x131c471b),
  new X64Word(0x28db77f5, 0x23047d84),
  new X64Word(0x32caab7b, 0x40c72493),
  new X64Word(0x3c9ebe0a, 0x15c9bebc),
  new X64Word(0x431d67c4, 0x9c100d4c),
  new X64Word(0x4cc5d4be, 0xcb3e42b6),
  new X64Word(0x597f299c, 0xfc657e2a),
  new X64Word(0x5fcb6fab, 0x3ad6faec),
  new X64Word(0x6c44198c, 0x4a475817),
];

// Reusable objects
const W = [];
for (let i = 0; i < 80; i += 1) {
  W[i] = new X64Word();
}

/**
 * SHA-512 hash algorithm.
 */
class SHA512Algo extends Hasher {
  constructor() {
    super();

    this.blockSize = 1024 / 32;
  }

  _doReset() {
    this._hash = new X64WordArray([
      new X64Word(0x6a09e667, 0xf3bcc908),
      new X64Word(0xbb67ae85, 0x84caa73b),
      new X64Word(0x3c6ef372, 0xfe94f82b),
      new X64Word(0xa54ff53a, 0x5f1d36f1),
      new X64Word(0x510e527f, 0xade682d1),
      new X64Word(0x9b05688c, 0x2b3e6c1f),
      new X64Word(0x1f83d9ab, 0xfb41bd6b),
      new X64Word(0x5be0cd19, 0x137e2179),
    ]);
  }

  _doProcessBlock(M, offset) {
    // Shortcuts
    const H = this._hash.words;

    const H0 = H[0];
    const H1 = H[1];
    const H2 = H[2];
    const H3 = H[3];
    const H4 = H[4];
    const H5 = H[5];
    const H6 = H[6];
    const H7 = H[7];

    const H0h = H0.high;
    let H0l = H0.low;
    const H1h = H1.high;
    let H1l = H1.low;
    const H2h = H2.high;
    let H2l = H2.low;
    const H3h = H3.high;
    let H3l = H3.low;
    const H4h = H4.high;
    let H4l = H4.low;
    const H5h = H5.high;
    let H5l = H5.low;
    const H6h = H6.high;
    let H6l = H6.low;
    const H7h = H7.high;
    let H7l = H7.low;

    // Working variables
    let ah = H0h;
    let al = H0l;
    let bh = H1h;
    let bl = H1l;
    let ch = H2h;
    let cl = H2l;
    let dh = H3h;
    let dl = H3l;
    let eh = H4h;
    let el = H4l;
    let fh = H5h;
    let fl = H5l;
    let gh = H6h;
    let gl = H6l;
    let hh = H7h;
    let hl = H7l;

    // Rounds
    for (let i = 0; i < 80; i += 1) {
      let Wil;
      let Wih;

      // Shortcut
      const Wi = W[i];

      // Extend message
      if (i < 16) {
        Wi.high = M[offset + i * 2] | 0;
        Wih = Wi.high;
        Wi.low = M[offset + i * 2 + 1] | 0;
        Wil = Wi.low;
      } else {
        // Gamma0
        const gamma0x = W[i - 15];
        const gamma0xh = gamma0x.high;
        const gamma0xl = gamma0x.low;
        const gamma0h = ((gamma0xh >>> 1) | (gamma0xl << 31))
          ^ ((gamma0xh >>> 8) | (gamma0xl << 24))
          ^ (gamma0xh >>> 7);
        const gamma0l = ((gamma0xl >>> 1) | (gamma0xh << 31))
          ^ ((gamma0xl >>> 8) | (gamma0xh << 24))
          ^ ((gamma0xl >>> 7) | (gamma0xh << 25));

        // Gamma1
        const gamma1x = W[i - 2];
        const gamma1xh = gamma1x.high;
        const gamma1xl = gamma1x.low;
        const gamma1h = ((gamma1xh >>> 19) | (gamma1xl << 13))
          ^ ((gamma1xh << 3) | (gamma1xl >>> 29))
          ^ (gamma1xh >>> 6);
        const gamma1l = ((gamma1xl >>> 19) | (gamma1xh << 13))
          ^ ((gamma1xl << 3) | (gamma1xh >>> 29))
          ^ ((gamma1xl >>> 6) | (gamma1xh << 26));

        // W[i] = gamma0 + W[i - 7] + gamma1 + W[i - 16]
        const Wi7 = W[i - 7];
        const Wi7h = Wi7.high;
        const Wi7l = Wi7.low;

        const Wi16 = W[i - 16];
        const Wi16h = Wi16.high;
        const Wi16l = Wi16.low;

        Wil = gamma0l + Wi7l;
        Wih = gamma0h + Wi7h + ((Wil >>> 0) < (gamma0l >>> 0) ? 1 : 0);
        Wil += gamma1l;
        Wih = Wih + gamma1h + ((Wil >>> 0) < (gamma1l >>> 0) ? 1 : 0);
        Wil += Wi16l;
        Wih = Wih + Wi16h + ((Wil >>> 0) < (Wi16l >>> 0) ? 1 : 0);

        Wi.high = Wih;
        Wi.low = Wil;
      }

      const chh = (eh & fh) ^ (~eh & gh);
      const chl = (el & fl) ^ (~el & gl);
      const majh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
      const majl = (al & bl) ^ (al & cl) ^ (bl & cl);

      const sigma0h = ((ah >>> 28) | (al << 4))
        ^ ((ah << 30) | (al >>> 2))
        ^ ((ah << 25) | (al >>> 7));
      const sigma0l = ((al >>> 28) | (ah << 4))
        ^ ((al << 30) | (ah >>> 2))
        ^ ((al << 25) | (ah >>> 7));
      const sigma1h = ((eh >>> 14) | (el << 18))
        ^ ((eh >>> 18) | (el << 14))
        ^ ((eh << 23) | (el >>> 9));
      const sigma1l = ((el >>> 14) | (eh << 18))
        ^ ((el >>> 18) | (eh << 14))
        ^ ((el << 23) | (eh >>> 9));

      // t1 = h + sigma1 + ch + K[i] + W[i]
      const Ki = K[i];
      const Kih = Ki.high;
      const Kil = Ki.low;

      let t1l = hl + sigma1l;
      let t1h = hh + sigma1h + ((t1l >>> 0) < (hl >>> 0) ? 1 : 0);
      t1l += chl;
      t1h = t1h + chh + ((t1l >>> 0) < (chl >>> 0) ? 1 : 0);
      t1l += Kil;
      t1h = t1h + Kih + ((t1l >>> 0) < (Kil >>> 0) ? 1 : 0);
      t1l += Wil;
      t1h = t1h + Wih + ((t1l >>> 0) < (Wil >>> 0) ? 1 : 0);

      // t2 = sigma0 + maj
      const t2l = sigma0l + majl;
      const t2h = sigma0h + majh + ((t2l >>> 0) < (sigma0l >>> 0) ? 1 : 0);

      // Update working variables
      hh = gh;
      hl = gl;
      gh = fh;
      gl = fl;
      fh = eh;
      fl = el;
      el = (dl + t1l) | 0;
      eh = (dh + t1h + ((el >>> 0) < (dl >>> 0) ? 1 : 0)) | 0;
      dh = ch;
      dl = cl;
      ch = bh;
      cl = bl;
      bh = ah;
      bl = al;
      al = (t1l + t2l) | 0;
      ah = (t1h + t2h + ((al >>> 0) < (t1l >>> 0) ? 1 : 0)) | 0;
    }

    // Intermediate hash value
    H0.low = (H0l + al);
    H0l = H0.low;
    H0.high = (H0h + ah + ((H0l >>> 0) < (al >>> 0) ? 1 : 0));
    H1.low = (H1l + bl);
    H1l = H1.low;
    H1.high = (H1h + bh + ((H1l >>> 0) < (bl >>> 0) ? 1 : 0));
    H2.low = (H2l + cl);
    H2l = H2.low;
    H2.high = (H2h + ch + ((H2l >>> 0) < (cl >>> 0) ? 1 : 0));
    H3.low = (H3l + dl);
    H3l = H3.low;
    H3.high = (H3h + dh + ((H3l >>> 0) < (dl >>> 0) ? 1 : 0));
    H4.low = (H4l + el);
    H4l = H4.low;
    H4.high = (H4h + eh + ((H4l >>> 0) < (el >>> 0) ? 1 : 0));
    H5.low = (H5l + fl);
    H5l = H5.low;
    H5.high = (H5h + fh + ((H5l >>> 0) < (fl >>> 0) ? 1 : 0));
    H6.low = (H6l + gl);
    H6l = H6.low;
    H6.high = (H6h + gh + ((H6l >>> 0) < (gl >>> 0) ? 1 : 0));
    H7.low = (H7l + hl);
    H7l = H7.low;
    H7.high = (H7h + hh + ((H7l >>> 0) < (hl >>> 0) ? 1 : 0));
  }

  _doFinalize() {
    // Shortcuts
    const data = this._data;
    const dataWords = data.words;

    const nBitsTotal = this._nDataBytes * 8;
    const nBitsLeft = data.sigBytes * 8;

    // Add padding
    dataWords[nBitsLeft >>> 5] |= 0x80 << (24 - (nBitsLeft % 32));
    dataWords[(((nBitsLeft + 128) >>> 10) << 5) + 30] = Math.floor(nBitsTotal / 0x100000000);
    dataWords[(((nBitsLeft + 128) >>> 10) << 5) + 31] = nBitsTotal;
    data.sigBytes = dataWords.length * 4;

    // Hash final blocks
    this._process();

    // Convert hash to 32-bit word array before returning
    const hash = this._hash.toX32();

    // Return final computed hash
    return hash;
  }

  clone() {
    const clone = super.clone.call(this);
    clone._hash = this._hash.clone();

    return clone;
  }
}

/**
 * Shortcut function to the hasher's object interface.
 *
 * @param {WordArray|string} message The message to hash.
 *
 * @return {WordArray} The hash.
 *
 * @static
 *
 * @example
 *
 *     var hash = CryptoJS.SHA512('message');
 *     var hash = CryptoJS.SHA512(wordArray);
 */
const SHA512 = Hasher._createHelper(SHA512Algo);

/**
 * Shortcut function to the HMAC's object interface.
 *
 * @param {WordArray|string} message The message to hash.
 * @param {WordArray|string} key The secret key.
 *
 * @return {WordArray} The HMAC.
 *
 * @static
 *
 * @example
 *
 *     var hmac = CryptoJS.HmacSHA512(message, key);
 */
const HmacSHA512 = Hasher._createHmacHelper(SHA512Algo);

/**
 * SHA-384 hash algorithm.
 */
class SHA384Algo extends SHA512Algo {
  _doReset() {
    this._hash = new X64WordArray([
      new X64Word(0xcbbb9d5d, 0xc1059ed8),
      new X64Word(0x629a292a, 0x367cd507),
      new X64Word(0x9159015a, 0x3070dd17),
      new X64Word(0x152fecd8, 0xf70e5939),
      new X64Word(0x67332667, 0xffc00b31),
      new X64Word(0x8eb44a87, 0x68581511),
      new X64Word(0xdb0c2e0d, 0x64f98fa7),
      new X64Word(0x47b5481d, 0xbefa4fa4),
    ]);
  }

  _doFinalize() {
    const hash = super._doFinalize.call(this);

    hash.sigBytes -= 16;

    return hash;
  }
}

/**
 * Shortcut function to the hasher's object interface.
 *
 * @param {WordArray|string} message The message to hash.
 *
 * @return {WordArray} The hash.
 *
 * @static
 *
 * @example
 *
 *     var hash = CryptoJS.SHA384('message');
 *     var hash = CryptoJS.SHA384(wordArray);
 */
const SHA384 = SHA512Algo._createHelper(SHA384Algo);

/**
 * Shortcut function to the HMAC's object interface.
 *
 * @param {WordArray|string} message The message to hash.
 * @param {WordArray|string} key The secret key.
 *
 * @return {WordArray} The HMAC.
 *
 * @static
 *
 * @example
 *
 *     var hmac = CryptoJS.HmacSHA384(message, key);
 */
const HmacSHA384 = SHA512Algo._createHmacHelper(SHA384Algo);

// Constants tables
const RHO_OFFSETS = [];
const PI_INDEXES = [];
const ROUND_CONSTANTS = [];

// Compute Constants
// Compute rho offset constants
let _x = 1;
let _y = 0;
for (let t = 0; t < 24; t += 1) {
  RHO_OFFSETS[_x + 5 * _y] = ((t + 1) * (t + 2) / 2) % 64;

  const newX = _y % 5;
  const newY = (2 * _x + 3 * _y) % 5;
  _x = newX;
  _y = newY;
}

// Compute pi index constants
for (let x = 0; x < 5; x += 1) {
  for (let y = 0; y < 5; y += 1) {
    PI_INDEXES[x + 5 * y] = y + ((2 * x + 3 * y) % 5) * 5;
  }
}

// Compute round constants
let LFSR = 0x01;
for (let i = 0; i < 24; i += 1) {
  let roundConstantMsw = 0;
  let roundConstantLsw = 0;

  for (let j = 0; j < 7; j += 1) {
    if (LFSR & 0x01) {
      const bitPosition = (1 << j) - 1;
      if (bitPosition < 32) {
        roundConstantLsw ^= 1 << bitPosition;
      } else /* if (bitPosition >= 32) */ {
        roundConstantMsw ^= 1 << (bitPosition - 32);
      }
    }

    // Compute next LFSR
    if (LFSR & 0x80) {
      // Primitive polynomial over GF(2): x^8 + x^6 + x^5 + x^4 + 1
      LFSR = (LFSR << 1) ^ 0x71;
    } else {
      LFSR <<= 1;
    }
  }

  ROUND_CONSTANTS[i] = X64Word.create(roundConstantMsw, roundConstantLsw);
}

// Reusable objects for temporary values
const T = [];
for (let i = 0; i < 25; i += 1) {
  T[i] = X64Word.create();
}

/**
 * SHA-3 hash algorithm.
 */
class SHA3Algo extends Hasher {
  constructor(cfg) {
    /**
     * Configuration options.
     *
     * @property {number} outputLength
     *   The desired number of bits in the output hash.
     *   Only values permitted are: 224, 256, 384, 512.
     *   Default: 512
     */
    super(Object.assign(
      { outputLength: 512 },
      cfg,
    ));
  }

  _doReset() {
    this._state = [];
    const state = this._state;
    for (let i = 0; i < 25; i += 1) {
      state[i] = new X64Word();
    }

    this.blockSize = (1600 - 2 * this.cfg.outputLength) / 32;
  }

  _doProcessBlock(M, offset) {
    // Shortcuts
    const state = this._state;
    const nBlockSizeLanes = this.blockSize / 2;

    // Absorb
    for (let i = 0; i < nBlockSizeLanes; i += 1) {
      // Shortcuts
      let M2i = M[offset + 2 * i];
      let M2i1 = M[offset + 2 * i + 1];

      // Swap endian
      M2i = (((M2i << 8) | (M2i >>> 24)) & 0x00ff00ff)
        | (((M2i << 24) | (M2i >>> 8)) & 0xff00ff00);
      M2i1 = (((M2i1 << 8) | (M2i1 >>> 24)) & 0x00ff00ff)
        | (((M2i1 << 24) | (M2i1 >>> 8)) & 0xff00ff00);

      // Absorb message into state
      const lane = state[i];
      lane.high ^= M2i1;
      lane.low ^= M2i;
    }

    // Rounds
    for (let round = 0; round < 24; round += 1) {
      // Theta
      for (let x = 0; x < 5; x += 1) {
        // Mix column lanes
        let tMsw = 0;
        let tLsw = 0;
        for (let y = 0; y < 5; y += 1) {
          const lane = state[x + 5 * y];
          tMsw ^= lane.high;
          tLsw ^= lane.low;
        }

        // Temporary values
        const Tx = T[x];
        Tx.high = tMsw;
        Tx.low = tLsw;
      }
      for (let x = 0; x < 5; x += 1) {
        // Shortcuts
        const Tx4 = T[(x + 4) % 5];
        const Tx1 = T[(x + 1) % 5];
        const Tx1Msw = Tx1.high;
        const Tx1Lsw = Tx1.low;

        // Mix surrounding columns
        const tMsw = Tx4.high ^ ((Tx1Msw << 1) | (Tx1Lsw >>> 31));
        const tLsw = Tx4.low ^ ((Tx1Lsw << 1) | (Tx1Msw >>> 31));
        for (let y = 0; y < 5; y += 1) {
          const lane = state[x + 5 * y];
          lane.high ^= tMsw;
          lane.low ^= tLsw;
        }
      }

      // Rho Pi
      for (let laneIndex = 1; laneIndex < 25; laneIndex += 1) {
        let tMsw;
        let tLsw;

        // Shortcuts
        const lane = state[laneIndex];
        const laneMsw = lane.high;
        const laneLsw = lane.low;
        const rhoOffset = RHO_OFFSETS[laneIndex];

        // Rotate lanes
        if (rhoOffset < 32) {
          tMsw = (laneMsw << rhoOffset) | (laneLsw >>> (32 - rhoOffset));
          tLsw = (laneLsw << rhoOffset) | (laneMsw >>> (32 - rhoOffset));
        } else /* if (rhoOffset >= 32) */ {
          tMsw = (laneLsw << (rhoOffset - 32)) | (laneMsw >>> (64 - rhoOffset));
          tLsw = (laneMsw << (rhoOffset - 32)) | (laneLsw >>> (64 - rhoOffset));
        }

        // Transpose lanes
        const TPiLane = T[PI_INDEXES[laneIndex]];
        TPiLane.high = tMsw;
        TPiLane.low = tLsw;
      }

      // Rho pi at x = y = 0
      const T0 = T[0];
      const state0 = state[0];
      T0.high = state0.high;
      T0.low = state0.low;

      // Chi
      for (let x = 0; x < 5; x += 1) {
        for (let y = 0; y < 5; y += 1) {
          // Shortcuts
          const laneIndex = x + 5 * y;
          const lane = state[laneIndex];
          const TLane = T[laneIndex];
          const Tx1Lane = T[((x + 1) % 5) + 5 * y];
          const Tx2Lane = T[((x + 2) % 5) + 5 * y];

          // Mix rows
          lane.high = TLane.high ^ (~Tx1Lane.high & Tx2Lane.high);
          lane.low = TLane.low ^ (~Tx1Lane.low & Tx2Lane.low);
        }
      }

      // Iota
      const lane = state[0];
      const roundConstant = ROUND_CONSTANTS[round];
      lane.high ^= roundConstant.high;
      lane.low ^= roundConstant.low;
    }
  }

  _doFinalize() {
    // Shortcuts
    const data = this._data;
    const dataWords = data.words;
    const nBitsLeft = data.sigBytes * 8;
    const blockSizeBits = this.blockSize * 32;

    // Add padding
    dataWords[nBitsLeft >>> 5] |= 0x1 << (24 - (nBitsLeft % 32));
    dataWords[((Math.ceil((nBitsLeft + 1) / blockSizeBits) * blockSizeBits) >>> 5) - 1] |= 0x80;
    data.sigBytes = dataWords.length * 4;

    // Hash final blocks
    this._process();

    // Shortcuts
    const state = this._state;
    const outputLengthBytes = this.cfg.outputLength / 8;
    const outputLengthLanes = outputLengthBytes / 8;

    // Squeeze
    const hashWords = [];
    for (let i = 0; i < outputLengthLanes; i += 1) {
      // Shortcuts
      const lane = state[i];
      let laneMsw = lane.high;
      let laneLsw = lane.low;

      // Swap endian
      laneMsw = (((laneMsw << 8) | (laneMsw >>> 24)) & 0x00ff00ff)
        | (((laneMsw << 24) | (laneMsw >>> 8)) & 0xff00ff00);
      laneLsw = (((laneLsw << 8) | (laneLsw >>> 24)) & 0x00ff00ff)
        | (((laneLsw << 24) | (laneLsw >>> 8)) & 0xff00ff00);

      // Squeeze state to retrieve hash
      hashWords.push(laneLsw);
      hashWords.push(laneMsw);
    }

    // Return final computed hash
    return new WordArray(hashWords, outputLengthBytes);
  }

  clone() {
    const clone = super.clone.call(this);

    clone._state = this._state.slice(0);
    const state = clone._state;
    for (let i = 0; i < 25; i += 1) {
      state[i] = state[i].clone();
    }

    return clone;
  }
}

/**
 * Shortcut function to the hasher's object interface.
 *
 * @param {WordArray|string} message The message to hash.
 *
 * @return {WordArray} The hash.
 *
 * @static
 *
 * @example
 *
 *     var hash = CryptoJS.SHA3('message');
 *     var hash = CryptoJS.SHA3(wordArray);
 */
const SHA3 = Hasher._createHelper(SHA3Algo);

/**
 * Shortcut function to the HMAC's object interface.
 *
 * @param {WordArray|string} message The message to hash.
 * @param {WordArray|string} key The secret key.
 *
 * @return {WordArray} The HMAC.
 *
 * @static
 *
 * @example
 *
 *     var hmac = CryptoJS.HmacSHA3(message, key);
 */
const HmacSHA3 = Hasher._createHmacHelper(SHA3Algo);

/** @preserve
(c) 2012 by Cédric Mesnil. All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted
provided that the following conditions are met:

    - Redistributions of source code must retain the above copyright notice, this list of
    conditions and the following disclaimer.
    - Redistributions in binary form must reproduce the above copyright notice, this list
    of conditions and the following disclaimer in the documentation and/or other materials
    provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS
OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY
WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

// Constants table
const _zl = WordArray.create([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
  3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
  1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
  4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13]);
const _zr = WordArray.create([
  5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
  6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
  15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
  8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
  12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11]);
const _sl = WordArray.create([
  11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
  7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
  11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
  11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
  9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6]);
const _sr = WordArray.create([
  8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
  9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
  9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
  15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
  8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11]);

const _hl = WordArray.create([0x00000000, 0x5A827999, 0x6ED9EBA1, 0x8F1BBCDC, 0xA953FD4E]);
const _hr = WordArray.create([0x50A28BE6, 0x5C4DD124, 0x6D703EF3, 0x7A6D76E9, 0x00000000]);

const f1 = (x, y, z) => (x) ^ (y) ^ (z);

const f2 = (x, y, z) => ((x) & (y)) | ((~x) & (z));

const f3 = (x, y, z) => ((x) | (~(y))) ^ (z);

const f4 = (x, y, z) => ((x) & (z)) | ((y) & (~(z)));

const f5 = (x, y, z) => (x) ^ ((y) | (~(z)));

const rotl = (x, n) => (x << n) | (x >>> (32 - n));

/**
 * RIPEMD160 hash algorithm.
 */
class RIPEMD160Algo extends Hasher {
  _doReset() {
    this._hash = WordArray.create([0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0]);
  }

  _doProcessBlock(M, offset) {
    const _M = M;

    // Swap endian
    for (let i = 0; i < 16; i += 1) {
      // Shortcuts
      const offset_i = offset + i;
      const M_offset_i = _M[offset_i];

      // Swap
      _M[offset_i] = (
        (((M_offset_i << 8) | (M_offset_i >>> 24)) & 0x00ff00ff)
          | (((M_offset_i << 24) | (M_offset_i >>> 8)) & 0xff00ff00)
      );
    }
    // Shortcut
    const H = this._hash.words;
    const hl = _hl.words;
    const hr = _hr.words;
    const zl = _zl.words;
    const zr = _zr.words;
    const sl = _sl.words;
    const sr = _sr.words;

    // Working variables
    let al = H[0];
    let bl = H[1];
    let cl = H[2];
    let dl = H[3];
    let el = H[4];
    let ar = H[0];
    let br = H[1];
    let cr = H[2];
    let dr = H[3];
    let er = H[4];

    // Computation
    let t;
    for (let i = 0; i < 80; i += 1) {
      t = (al + _M[offset + zl[i]]) | 0;
      if (i < 16) {
        t += f1(bl, cl, dl) + hl[0];
      } else if (i < 32) {
        t += f2(bl, cl, dl) + hl[1];
      } else if (i < 48) {
        t += f3(bl, cl, dl) + hl[2];
      } else if (i < 64) {
        t += f4(bl, cl, dl) + hl[3];
      } else { // if (i<80) {
        t += f5(bl, cl, dl) + hl[4];
      }
      t |= 0;
      t = rotl(t, sl[i]);
      t = (t + el) | 0;
      al = el;
      el = dl;
      dl = rotl(cl, 10);
      cl = bl;
      bl = t;

      t = (ar + _M[offset + zr[i]]) | 0;
      if (i < 16) {
        t += f5(br, cr, dr) + hr[0];
      } else if (i < 32) {
        t += f4(br, cr, dr) + hr[1];
      } else if (i < 48) {
        t += f3(br, cr, dr) + hr[2];
      } else if (i < 64) {
        t += f2(br, cr, dr) + hr[3];
      } else { // if (i<80) {
        t += f1(br, cr, dr) + hr[4];
      }
      t |= 0;
      t = rotl(t, sr[i]);
      t = (t + er) | 0;
      ar = er;
      er = dr;
      dr = rotl(cr, 10);
      cr = br;
      br = t;
    }
    // Intermediate hash value
    t = (H[1] + cl + dr) | 0;
    H[1] = (H[2] + dl + er) | 0;
    H[2] = (H[3] + el + ar) | 0;
    H[3] = (H[4] + al + br) | 0;
    H[4] = (H[0] + bl + cr) | 0;
    H[0] = t;
  }

  _doFinalize() {
    // Shortcuts
    const data = this._data;
    const dataWords = data.words;

    const nBitsTotal = this._nDataBytes * 8;
    const nBitsLeft = data.sigBytes * 8;

    // Add padding
    dataWords[nBitsLeft >>> 5] |= 0x80 << (24 - (nBitsLeft % 32));
    dataWords[(((nBitsLeft + 64) >>> 9) << 4) + 14] = (
      (((nBitsTotal << 8) | (nBitsTotal >>> 24)) & 0x00ff00ff)
        | (((nBitsTotal << 24) | (nBitsTotal >>> 8)) & 0xff00ff00)
    );
    data.sigBytes = (dataWords.length + 1) * 4;

    // Hash final blocks
    this._process();

    // Shortcuts
    const hash = this._hash;
    const H = hash.words;

    // Swap endian
    for (let i = 0; i < 5; i += 1) {
      // Shortcut
      const H_i = H[i];

      // Swap
      H[i] = (((H_i << 8) | (H_i >>> 24)) & 0x00ff00ff)
        | (((H_i << 24) | (H_i >>> 8)) & 0xff00ff00);
    }

    // Return final computed hash
    return hash;
  }

  clone() {
    const clone = super.clone.call(this);
    clone._hash = this._hash.clone();

    return clone;
  }
}

/**
 * Shortcut function to the hasher's object interface.
 *
 * @param {WordArray|string} message The message to hash.
 *
 * @return {WordArray} The hash.
 *
 * @static
 *
 * @example
 *
 *     var hash = CryptoJS.RIPEMD160('message');
 *     var hash = CryptoJS.RIPEMD160(wordArray);
 */
const RIPEMD160 = Hasher._createHelper(RIPEMD160Algo);

/**
 * Shortcut function to the HMAC's object interface.
 *
 * @param {WordArray|string} message The message to hash.
 * @param {WordArray|string} key The secret key.
 *
 * @return {WordArray} The HMAC.
 *
 * @static
 *
 * @example
 *
 *     var hmac = CryptoJS.HmacRIPEMD160(message, key);
 */
const HmacRIPEMD160 = Hasher._createHmacHelper(RIPEMD160Algo);

/**
 * Password-Based Key Derivation Function 2 algorithm.
 */
class PBKDF2Algo extends Base {
  /**
   * Initializes a newly created key derivation function.
   *
   * @param {Object} cfg (Optional) The configuration options to use for the derivation.
   *
   * @example
   *
   *     const kdf = CryptoJS.algo.PBKDF2.create();
   *     const kdf = CryptoJS.algo.PBKDF2.create({ keySize: 8 });
   *     const kdf = CryptoJS.algo.PBKDF2.create({ keySize: 8, iterations: 1000 });
   */
  constructor(cfg) {
    super();

    /**
     * Configuration options.
     *
     * @property {number} keySize The key size in words to generate. Default: 4 (128 bits)
     * @property {Hasher} hasher The hasher to use. Default: SHA1
     * @property {number} iterations The number of iterations to perform. Default: 1
     */
    this.cfg = Object.assign(
      new Base(),
      {
        keySize: 128 / 32,
        hasher: SHA1Algo,
        iterations: 1,
      },
      cfg,
    );
  }

  /**
   * Computes the Password-Based Key Derivation Function 2.
   *
   * @param {WordArray|string} password The password.
   * @param {WordArray|string} salt A salt.
   *
   * @return {WordArray} The derived key.
   *
   * @example
   *
   *     const key = kdf.compute(password, salt);
   */
  compute(password, salt) {
    // Shortcut
    const { cfg } = this;

    // Init HMAC
    const hmac = HMAC.create(cfg.hasher, password);

    // Initial values
    const derivedKey = WordArray.create();
    const blockIndex = WordArray.create([0x00000001]);

    // Shortcuts
    const derivedKeyWords = derivedKey.words;
    const blockIndexWords = blockIndex.words;
    const { keySize, iterations } = cfg;

    // Generate key
    while (derivedKeyWords.length < keySize) {
      const block = hmac.update(salt).finalize(blockIndex);
      hmac.reset();

      // Shortcuts
      const blockWords = block.words;
      const blockWordsLength = blockWords.length;

      // Iterations
      let intermediate = block;
      for (let i = 1; i < iterations; i += 1) {
        intermediate = hmac.finalize(intermediate);
        hmac.reset();

        // Shortcut
        const intermediateWords = intermediate.words;

        // XOR intermediate with block
        for (let j = 0; j < blockWordsLength; j += 1) {
          blockWords[j] ^= intermediateWords[j];
        }
      }

      derivedKey.concat(block);
      blockIndexWords[0] += 1;
    }
    derivedKey.sigBytes = keySize * 4;

    return derivedKey;
  }
}

/**
 * Computes the Password-Based Key Derivation Function 2.
 *
 * @param {WordArray|string} password The password.
 * @param {WordArray|string} salt A salt.
 * @param {Object} cfg (Optional) The configuration options to use for this computation.
 *
 * @return {WordArray} The derived key.
 *
 * @static
 *
 * @example
 *
 *     var key = CryptoJS.PBKDF2(password, salt);
 *     var key = CryptoJS.PBKDF2(password, salt, { keySize: 8 });
 *     var key = CryptoJS.PBKDF2(password, salt, { keySize: 8, iterations: 1000 });
 */
const PBKDF2 = (password, salt, cfg) => PBKDF2Algo.create(cfg).compute(password, salt);

// Lookup tables
const _SBOX = [];
const INV_SBOX = [];
const _SUB_MIX_0 = [];
const _SUB_MIX_1 = [];
const _SUB_MIX_2 = [];
const _SUB_MIX_3 = [];
const INV_SUB_MIX_0 = [];
const INV_SUB_MIX_1 = [];
const INV_SUB_MIX_2 = [];
const INV_SUB_MIX_3 = [];

// Compute lookup tables

// Compute double table
const d = [];
for (let i = 0; i < 256; i += 1) {
  if (i < 128) {
    d[i] = i << 1;
  } else {
    d[i] = (i << 1) ^ 0x11b;
  }
}

// Walk GF(2^8)
let x = 0;
let xi = 0;
for (let i = 0; i < 256; i += 1) {
  // Compute sbox
  let sx = xi ^ (xi << 1) ^ (xi << 2) ^ (xi << 3) ^ (xi << 4);
  sx = (sx >>> 8) ^ (sx & 0xff) ^ 0x63;
  _SBOX[x] = sx;
  INV_SBOX[sx] = x;

  // Compute multiplication
  const x2 = d[x];
  const x4 = d[x2];
  const x8 = d[x4];

  // Compute sub bytes, mix columns tables
  let t = (d[sx] * 0x101) ^ (sx * 0x1010100);
  _SUB_MIX_0[x] = (t << 24) | (t >>> 8);
  _SUB_MIX_1[x] = (t << 16) | (t >>> 16);
  _SUB_MIX_2[x] = (t << 8) | (t >>> 24);
  _SUB_MIX_3[x] = t;

  // Compute inv sub bytes, inv mix columns tables
  t = (x8 * 0x1010101) ^ (x4 * 0x10001) ^ (x2 * 0x101) ^ (x * 0x1010100);
  INV_SUB_MIX_0[sx] = (t << 24) | (t >>> 8);
  INV_SUB_MIX_1[sx] = (t << 16) | (t >>> 16);
  INV_SUB_MIX_2[sx] = (t << 8) | (t >>> 24);
  INV_SUB_MIX_3[sx] = t;

  // Compute next counter
  if (!x) {
    xi = 1;
    x = xi;
  } else {
    x = x2 ^ d[d[d[x8 ^ x2]]];
    xi ^= d[d[xi]];
  }
}

// Precomputed Rcon lookup
const RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

/**
 * AES block cipher algorithm.
 */
class AESAlgo extends BlockCipher {
  _doReset() {
    let t;

    // Skip reset of nRounds has been set before and key did not change
    if (this._nRounds && this._keyPriorReset === this._key) {
      return;
    }

    // Shortcuts
    this._keyPriorReset = this._key;
    const key = this._keyPriorReset;
    const keyWords = key.words;
    const keySize = key.sigBytes / 4;

    // Compute number of rounds
    this._nRounds = keySize + 6;
    const nRounds = this._nRounds;

    // Compute number of key schedule rows
    const ksRows = (nRounds + 1) * 4;

    // Compute key schedule
    this._keySchedule = [];
    const keySchedule = this._keySchedule;
    for (let ksRow = 0; ksRow < ksRows; ksRow += 1) {
      if (ksRow < keySize) {
        keySchedule[ksRow] = keyWords[ksRow];
      } else {
        t = keySchedule[ksRow - 1];

        if (!(ksRow % keySize)) {
          // Rot word
          t = (t << 8) | (t >>> 24);

          // Sub word
          t = (_SBOX[t >>> 24] << 24)
            | (_SBOX[(t >>> 16) & 0xff] << 16)
            | (_SBOX[(t >>> 8) & 0xff] << 8)
            | _SBOX[t & 0xff];

          // Mix Rcon
          t ^= RCON[(ksRow / keySize) | 0] << 24;
        } else if (keySize > 6 && ksRow % keySize === 4) {
          // Sub word
          t = (_SBOX[t >>> 24] << 24)
            | (_SBOX[(t >>> 16) & 0xff] << 16)
            | (_SBOX[(t >>> 8) & 0xff] << 8)
            | _SBOX[t & 0xff];
        }

        keySchedule[ksRow] = keySchedule[ksRow - keySize] ^ t;
      }
    }

    // Compute inv key schedule
    this._invKeySchedule = [];
    const invKeySchedule = this._invKeySchedule;
    for (let invKsRow = 0; invKsRow < ksRows; invKsRow += 1) {
      const ksRow = ksRows - invKsRow;

      if (invKsRow % 4) {
        t = keySchedule[ksRow];
      } else {
        t = keySchedule[ksRow - 4];
      }

      if (invKsRow < 4 || ksRow <= 4) {
        invKeySchedule[invKsRow] = t;
      } else {
        invKeySchedule[invKsRow] = INV_SUB_MIX_0[_SBOX[t >>> 24]]
          ^ INV_SUB_MIX_1[_SBOX[(t >>> 16) & 0xff]]
          ^ INV_SUB_MIX_2[_SBOX[(t >>> 8) & 0xff]]
          ^ INV_SUB_MIX_3[_SBOX[t & 0xff]];
      }
    }
  }

  encryptBlock(M, offset) {
    this._doCryptBlock(
      M, offset, this._keySchedule, _SUB_MIX_0, _SUB_MIX_1, _SUB_MIX_2, _SUB_MIX_3, _SBOX,
    );
  }

  decryptBlock(M, offset) {
    const _M = M;

    // Swap 2nd and 4th rows
    let t = _M[offset + 1];
    _M[offset + 1] = _M[offset + 3];
    _M[offset + 3] = t;

    this._doCryptBlock(
      _M,
      offset,
      this._invKeySchedule,
      INV_SUB_MIX_0,
      INV_SUB_MIX_1,
      INV_SUB_MIX_2,
      INV_SUB_MIX_3,
      INV_SBOX,
    );

    // Inv swap 2nd and 4th rows
    t = _M[offset + 1];
    _M[offset + 1] = _M[offset + 3];
    _M[offset + 3] = t;
  }

  _doCryptBlock(M, offset, keySchedule, SUB_MIX_0, SUB_MIX_1, SUB_MIX_2, SUB_MIX_3, SBOX) {
    const _M = M;

    // Shortcut
    const nRounds = this._nRounds;

    // Get input, add round key
    let s0 = _M[offset] ^ keySchedule[0];
    let s1 = _M[offset + 1] ^ keySchedule[1];
    let s2 = _M[offset + 2] ^ keySchedule[2];
    let s3 = _M[offset + 3] ^ keySchedule[3];

    // Key schedule row counter
    let ksRow = 4;

    // Rounds
    for (let round = 1; round < nRounds; round += 1) {
      // Shift rows, sub bytes, mix columns, add round key
      const t0 = SUB_MIX_0[s0 >>> 24]
        ^ SUB_MIX_1[(s1 >>> 16) & 0xff]
        ^ SUB_MIX_2[(s2 >>> 8) & 0xff]
        ^ SUB_MIX_3[s3 & 0xff]
        ^ keySchedule[ksRow];
      ksRow += 1;
      const t1 = SUB_MIX_0[s1 >>> 24]
        ^ SUB_MIX_1[(s2 >>> 16) & 0xff]
        ^ SUB_MIX_2[(s3 >>> 8) & 0xff]
        ^ SUB_MIX_3[s0 & 0xff]
        ^ keySchedule[ksRow];
      ksRow += 1;
      const t2 = SUB_MIX_0[s2 >>> 24]
        ^ SUB_MIX_1[(s3 >>> 16) & 0xff]
        ^ SUB_MIX_2[(s0 >>> 8) & 0xff]
        ^ SUB_MIX_3[s1 & 0xff]
        ^ keySchedule[ksRow];
      ksRow += 1;
      const t3 = SUB_MIX_0[s3 >>> 24]
        ^ SUB_MIX_1[(s0 >>> 16) & 0xff]
        ^ SUB_MIX_2[(s1 >>> 8) & 0xff]
        ^ SUB_MIX_3[s2 & 0xff]
        ^ keySchedule[ksRow];
      ksRow += 1;

      // Update state
      s0 = t0;
      s1 = t1;
      s2 = t2;
      s3 = t3;
    }

    // Shift rows, sub bytes, add round key
    const t0 = (
      (SBOX[s0 >>> 24] << 24)
        | (SBOX[(s1 >>> 16) & 0xff] << 16)
        | (SBOX[(s2 >>> 8) & 0xff] << 8)
        | SBOX[s3 & 0xff]
    ) ^ keySchedule[ksRow];
    ksRow += 1;
    const t1 = (
      (SBOX[s1 >>> 24] << 24)
        | (SBOX[(s2 >>> 16) & 0xff] << 16)
        | (SBOX[(s3 >>> 8) & 0xff] << 8)
        | SBOX[s0 & 0xff]
    ) ^ keySchedule[ksRow];
    ksRow += 1;
    const t2 = (
      (SBOX[s2 >>> 24] << 24)
        | (SBOX[(s3 >>> 16) & 0xff] << 16)
        | (SBOX[(s0 >>> 8) & 0xff] << 8)
        | SBOX[s1 & 0xff]
    ) ^ keySchedule[ksRow];
    ksRow += 1;
    const t3 = (
      (SBOX[s3 >>> 24] << 24)
        | (SBOX[(s0 >>> 16) & 0xff] << 16) | (SBOX[(s1 >>> 8) & 0xff] << 8) | SBOX[s2 & 0xff]
    ) ^ keySchedule[ksRow];
    ksRow += 1;

    // Set output
    _M[offset] = t0;
    _M[offset + 1] = t1;
    _M[offset + 2] = t2;
    _M[offset + 3] = t3;
  }
}
AESAlgo.keySize = 256 / 32;

/**
 * Shortcut functions to the cipher's object interface.
 *
 * @example
 *
 *     var ciphertext = CryptoJS.AES.encrypt(message, key, cfg);
 *     var plaintext  = CryptoJS.AES.decrypt(ciphertext, key, cfg);
 */
const AES = BlockCipher._createHelper(AESAlgo);

// Permuted Choice 1 constants
const PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1,
  58, 50, 42, 34, 26, 18, 10, 2,
  59, 51, 43, 35, 27, 19, 11, 3,
  60, 52, 44, 36, 63, 55, 47, 39,
  31, 23, 15, 7, 62, 54, 46, 38,
  30, 22, 14, 6, 61, 53, 45, 37,
  29, 21, 13, 5, 28, 20, 12, 4,
];

// Permuted Choice 2 constants
const PC2 = [
  14, 17, 11, 24, 1, 5,
  3, 28, 15, 6, 21, 10,
  23, 19, 12, 4, 26, 8,
  16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55,
  30, 40, 51, 45, 33, 48,
  44, 49, 39, 56, 34, 53,
  46, 42, 50, 36, 29, 32,
];

// Cumulative bit shift constants
const BIT_SHIFTS = [1, 2, 4, 6, 8, 10, 12, 14, 15, 17, 19, 21, 23, 25, 27, 28];

// SBOXes and round permutation constants
const SBOX_P = [
  {
    0x0: 0x808200,
    0x10000000: 0x8000,
    0x20000000: 0x808002,
    0x30000000: 0x2,
    0x40000000: 0x200,
    0x50000000: 0x808202,
    0x60000000: 0x800202,
    0x70000000: 0x800000,
    0x80000000: 0x202,
    0x90000000: 0x800200,
    0xa0000000: 0x8200,
    0xb0000000: 0x808000,
    0xc0000000: 0x8002,
    0xd0000000: 0x800002,
    0xe0000000: 0x0,
    0xf0000000: 0x8202,
    0x8000000: 0x0,
    0x18000000: 0x808202,
    0x28000000: 0x8202,
    0x38000000: 0x8000,
    0x48000000: 0x808200,
    0x58000000: 0x200,
    0x68000000: 0x808002,
    0x78000000: 0x2,
    0x88000000: 0x800200,
    0x98000000: 0x8200,
    0xa8000000: 0x808000,
    0xb8000000: 0x800202,
    0xc8000000: 0x800002,
    0xd8000000: 0x8002,
    0xe8000000: 0x202,
    0xf8000000: 0x800000,
    0x1: 0x8000,
    0x10000001: 0x2,
    0x20000001: 0x808200,
    0x30000001: 0x800000,
    0x40000001: 0x808002,
    0x50000001: 0x8200,
    0x60000001: 0x200,
    0x70000001: 0x800202,
    0x80000001: 0x808202,
    0x90000001: 0x808000,
    0xa0000001: 0x800002,
    0xb0000001: 0x8202,
    0xc0000001: 0x202,
    0xd0000001: 0x800200,
    0xe0000001: 0x8002,
    0xf0000001: 0x0,
    0x8000001: 0x808202,
    0x18000001: 0x808000,
    0x28000001: 0x800000,
    0x38000001: 0x200,
    0x48000001: 0x8000,
    0x58000001: 0x800002,
    0x68000001: 0x2,
    0x78000001: 0x8202,
    0x88000001: 0x8002,
    0x98000001: 0x800202,
    0xa8000001: 0x202,
    0xb8000001: 0x808200,
    0xc8000001: 0x800200,
    0xd8000001: 0x0,
    0xe8000001: 0x8200,
    0xf8000001: 0x808002,
  },
  {
    0x0: 0x40084010,
    0x1000000: 0x4000,
    0x2000000: 0x80000,
    0x3000000: 0x40080010,
    0x4000000: 0x40000010,
    0x5000000: 0x40084000,
    0x6000000: 0x40004000,
    0x7000000: 0x10,
    0x8000000: 0x84000,
    0x9000000: 0x40004010,
    0xa000000: 0x40000000,
    0xb000000: 0x84010,
    0xc000000: 0x80010,
    0xd000000: 0x0,
    0xe000000: 0x4010,
    0xf000000: 0x40080000,
    0x800000: 0x40004000,
    0x1800000: 0x84010,
    0x2800000: 0x10,
    0x3800000: 0x40004010,
    0x4800000: 0x40084010,
    0x5800000: 0x40000000,
    0x6800000: 0x80000,
    0x7800000: 0x40080010,
    0x8800000: 0x80010,
    0x9800000: 0x0,
    0xa800000: 0x4000,
    0xb800000: 0x40080000,
    0xc800000: 0x40000010,
    0xd800000: 0x84000,
    0xe800000: 0x40084000,
    0xf800000: 0x4010,
    0x10000000: 0x0,
    0x11000000: 0x40080010,
    0x12000000: 0x40004010,
    0x13000000: 0x40084000,
    0x14000000: 0x40080000,
    0x15000000: 0x10,
    0x16000000: 0x84010,
    0x17000000: 0x4000,
    0x18000000: 0x4010,
    0x19000000: 0x80000,
    0x1a000000: 0x80010,
    0x1b000000: 0x40000010,
    0x1c000000: 0x84000,
    0x1d000000: 0x40004000,
    0x1e000000: 0x40000000,
    0x1f000000: 0x40084010,
    0x10800000: 0x84010,
    0x11800000: 0x80000,
    0x12800000: 0x40080000,
    0x13800000: 0x4000,
    0x14800000: 0x40004000,
    0x15800000: 0x40084010,
    0x16800000: 0x10,
    0x17800000: 0x40000000,
    0x18800000: 0x40084000,
    0x19800000: 0x40000010,
    0x1a800000: 0x40004010,
    0x1b800000: 0x80010,
    0x1c800000: 0x0,
    0x1d800000: 0x4010,
    0x1e800000: 0x40080010,
    0x1f800000: 0x84000,
  },
  {
    0x0: 0x104,
    0x100000: 0x0,
    0x200000: 0x4000100,
    0x300000: 0x10104,
    0x400000: 0x10004,
    0x500000: 0x4000004,
    0x600000: 0x4010104,
    0x700000: 0x4010000,
    0x800000: 0x4000000,
    0x900000: 0x4010100,
    0xa00000: 0x10100,
    0xb00000: 0x4010004,
    0xc00000: 0x4000104,
    0xd00000: 0x10000,
    0xe00000: 0x4,
    0xf00000: 0x100,
    0x80000: 0x4010100,
    0x180000: 0x4010004,
    0x280000: 0x0,
    0x380000: 0x4000100,
    0x480000: 0x4000004,
    0x580000: 0x10000,
    0x680000: 0x10004,
    0x780000: 0x104,
    0x880000: 0x4,
    0x980000: 0x100,
    0xa80000: 0x4010000,
    0xb80000: 0x10104,
    0xc80000: 0x10100,
    0xd80000: 0x4000104,
    0xe80000: 0x4010104,
    0xf80000: 0x4000000,
    0x1000000: 0x4010100,
    0x1100000: 0x10004,
    0x1200000: 0x10000,
    0x1300000: 0x4000100,
    0x1400000: 0x100,
    0x1500000: 0x4010104,
    0x1600000: 0x4000004,
    0x1700000: 0x0,
    0x1800000: 0x4000104,
    0x1900000: 0x4000000,
    0x1a00000: 0x4,
    0x1b00000: 0x10100,
    0x1c00000: 0x4010000,
    0x1d00000: 0x104,
    0x1e00000: 0x10104,
    0x1f00000: 0x4010004,
    0x1080000: 0x4000000,
    0x1180000: 0x104,
    0x1280000: 0x4010100,
    0x1380000: 0x0,
    0x1480000: 0x10004,
    0x1580000: 0x4000100,
    0x1680000: 0x100,
    0x1780000: 0x4010004,
    0x1880000: 0x10000,
    0x1980000: 0x4010104,
    0x1a80000: 0x10104,
    0x1b80000: 0x4000004,
    0x1c80000: 0x4000104,
    0x1d80000: 0x4010000,
    0x1e80000: 0x4,
    0x1f80000: 0x10100,
  },
  {
    0x0: 0x80401000,
    0x10000: 0x80001040,
    0x20000: 0x401040,
    0x30000: 0x80400000,
    0x40000: 0x0,
    0x50000: 0x401000,
    0x60000: 0x80000040,
    0x70000: 0x400040,
    0x80000: 0x80000000,
    0x90000: 0x400000,
    0xa0000: 0x40,
    0xb0000: 0x80001000,
    0xc0000: 0x80400040,
    0xd0000: 0x1040,
    0xe0000: 0x1000,
    0xf0000: 0x80401040,
    0x8000: 0x80001040,
    0x18000: 0x40,
    0x28000: 0x80400040,
    0x38000: 0x80001000,
    0x48000: 0x401000,
    0x58000: 0x80401040,
    0x68000: 0x0,
    0x78000: 0x80400000,
    0x88000: 0x1000,
    0x98000: 0x80401000,
    0xa8000: 0x400000,
    0xb8000: 0x1040,
    0xc8000: 0x80000000,
    0xd8000: 0x400040,
    0xe8000: 0x401040,
    0xf8000: 0x80000040,
    0x100000: 0x400040,
    0x110000: 0x401000,
    0x120000: 0x80000040,
    0x130000: 0x0,
    0x140000: 0x1040,
    0x150000: 0x80400040,
    0x160000: 0x80401000,
    0x170000: 0x80001040,
    0x180000: 0x80401040,
    0x190000: 0x80000000,
    0x1a0000: 0x80400000,
    0x1b0000: 0x401040,
    0x1c0000: 0x80001000,
    0x1d0000: 0x400000,
    0x1e0000: 0x40,
    0x1f0000: 0x1000,
    0x108000: 0x80400000,
    0x118000: 0x80401040,
    0x128000: 0x0,
    0x138000: 0x401000,
    0x148000: 0x400040,
    0x158000: 0x80000000,
    0x168000: 0x80001040,
    0x178000: 0x40,
    0x188000: 0x80000040,
    0x198000: 0x1000,
    0x1a8000: 0x80001000,
    0x1b8000: 0x80400040,
    0x1c8000: 0x1040,
    0x1d8000: 0x80401000,
    0x1e8000: 0x400000,
    0x1f8000: 0x401040,
  },
  {
    0x0: 0x80,
    0x1000: 0x1040000,
    0x2000: 0x40000,
    0x3000: 0x20000000,
    0x4000: 0x20040080,
    0x5000: 0x1000080,
    0x6000: 0x21000080,
    0x7000: 0x40080,
    0x8000: 0x1000000,
    0x9000: 0x20040000,
    0xa000: 0x20000080,
    0xb000: 0x21040080,
    0xc000: 0x21040000,
    0xd000: 0x0,
    0xe000: 0x1040080,
    0xf000: 0x21000000,
    0x800: 0x1040080,
    0x1800: 0x21000080,
    0x2800: 0x80,
    0x3800: 0x1040000,
    0x4800: 0x40000,
    0x5800: 0x20040080,
    0x6800: 0x21040000,
    0x7800: 0x20000000,
    0x8800: 0x20040000,
    0x9800: 0x0,
    0xa800: 0x21040080,
    0xb800: 0x1000080,
    0xc800: 0x20000080,
    0xd800: 0x21000000,
    0xe800: 0x1000000,
    0xf800: 0x40080,
    0x10000: 0x40000,
    0x11000: 0x80,
    0x12000: 0x20000000,
    0x13000: 0x21000080,
    0x14000: 0x1000080,
    0x15000: 0x21040000,
    0x16000: 0x20040080,
    0x17000: 0x1000000,
    0x18000: 0x21040080,
    0x19000: 0x21000000,
    0x1a000: 0x1040000,
    0x1b000: 0x20040000,
    0x1c000: 0x40080,
    0x1d000: 0x20000080,
    0x1e000: 0x0,
    0x1f000: 0x1040080,
    0x10800: 0x21000080,
    0x11800: 0x1000000,
    0x12800: 0x1040000,
    0x13800: 0x20040080,
    0x14800: 0x20000000,
    0x15800: 0x1040080,
    0x16800: 0x80,
    0x17800: 0x21040000,
    0x18800: 0x40080,
    0x19800: 0x21040080,
    0x1a800: 0x0,
    0x1b800: 0x21000000,
    0x1c800: 0x1000080,
    0x1d800: 0x40000,
    0x1e800: 0x20040000,
    0x1f800: 0x20000080,
  },
  {
    0x0: 0x10000008,
    0x100: 0x2000,
    0x200: 0x10200000,
    0x300: 0x10202008,
    0x400: 0x10002000,
    0x500: 0x200000,
    0x600: 0x200008,
    0x700: 0x10000000,
    0x800: 0x0,
    0x900: 0x10002008,
    0xa00: 0x202000,
    0xb00: 0x8,
    0xc00: 0x10200008,
    0xd00: 0x202008,
    0xe00: 0x2008,
    0xf00: 0x10202000,
    0x80: 0x10200000,
    0x180: 0x10202008,
    0x280: 0x8,
    0x380: 0x200000,
    0x480: 0x202008,
    0x580: 0x10000008,
    0x680: 0x10002000,
    0x780: 0x2008,
    0x880: 0x200008,
    0x980: 0x2000,
    0xa80: 0x10002008,
    0xb80: 0x10200008,
    0xc80: 0x0,
    0xd80: 0x10202000,
    0xe80: 0x202000,
    0xf80: 0x10000000,
    0x1000: 0x10002000,
    0x1100: 0x10200008,
    0x1200: 0x10202008,
    0x1300: 0x2008,
    0x1400: 0x200000,
    0x1500: 0x10000000,
    0x1600: 0x10000008,
    0x1700: 0x202000,
    0x1800: 0x202008,
    0x1900: 0x0,
    0x1a00: 0x8,
    0x1b00: 0x10200000,
    0x1c00: 0x2000,
    0x1d00: 0x10002008,
    0x1e00: 0x10202000,
    0x1f00: 0x200008,
    0x1080: 0x8,
    0x1180: 0x202000,
    0x1280: 0x200000,
    0x1380: 0x10000008,
    0x1480: 0x10002000,
    0x1580: 0x2008,
    0x1680: 0x10202008,
    0x1780: 0x10200000,
    0x1880: 0x10202000,
    0x1980: 0x10200008,
    0x1a80: 0x2000,
    0x1b80: 0x202008,
    0x1c80: 0x200008,
    0x1d80: 0x0,
    0x1e80: 0x10000000,
    0x1f80: 0x10002008,
  },
  {
    0x0: 0x100000,
    0x10: 0x2000401,
    0x20: 0x400,
    0x30: 0x100401,
    0x40: 0x2100401,
    0x50: 0x0,
    0x60: 0x1,
    0x70: 0x2100001,
    0x80: 0x2000400,
    0x90: 0x100001,
    0xa0: 0x2000001,
    0xb0: 0x2100400,
    0xc0: 0x2100000,
    0xd0: 0x401,
    0xe0: 0x100400,
    0xf0: 0x2000000,
    0x8: 0x2100001,
    0x18: 0x0,
    0x28: 0x2000401,
    0x38: 0x2100400,
    0x48: 0x100000,
    0x58: 0x2000001,
    0x68: 0x2000000,
    0x78: 0x401,
    0x88: 0x100401,
    0x98: 0x2000400,
    0xa8: 0x2100000,
    0xb8: 0x100001,
    0xc8: 0x400,
    0xd8: 0x2100401,
    0xe8: 0x1,
    0xf8: 0x100400,
    0x100: 0x2000000,
    0x110: 0x100000,
    0x120: 0x2000401,
    0x130: 0x2100001,
    0x140: 0x100001,
    0x150: 0x2000400,
    0x160: 0x2100400,
    0x170: 0x100401,
    0x180: 0x401,
    0x190: 0x2100401,
    0x1a0: 0x100400,
    0x1b0: 0x1,
    0x1c0: 0x0,
    0x1d0: 0x2100000,
    0x1e0: 0x2000001,
    0x1f0: 0x400,
    0x108: 0x100400,
    0x118: 0x2000401,
    0x128: 0x2100001,
    0x138: 0x1,
    0x148: 0x2000000,
    0x158: 0x100000,
    0x168: 0x401,
    0x178: 0x2100400,
    0x188: 0x2000001,
    0x198: 0x2100000,
    0x1a8: 0x0,
    0x1b8: 0x2100401,
    0x1c8: 0x100401,
    0x1d8: 0x400,
    0x1e8: 0x2000400,
    0x1f8: 0x100001,
  },
  {
    0x0: 0x8000820,
    0x1: 0x20000,
    0x2: 0x8000000,
    0x3: 0x20,
    0x4: 0x20020,
    0x5: 0x8020820,
    0x6: 0x8020800,
    0x7: 0x800,
    0x8: 0x8020000,
    0x9: 0x8000800,
    0xa: 0x20800,
    0xb: 0x8020020,
    0xc: 0x820,
    0xd: 0x0,
    0xe: 0x8000020,
    0xf: 0x20820,
    0x80000000: 0x800,
    0x80000001: 0x8020820,
    0x80000002: 0x8000820,
    0x80000003: 0x8000000,
    0x80000004: 0x8020000,
    0x80000005: 0x20800,
    0x80000006: 0x20820,
    0x80000007: 0x20,
    0x80000008: 0x8000020,
    0x80000009: 0x820,
    0x8000000a: 0x20020,
    0x8000000b: 0x8020800,
    0x8000000c: 0x0,
    0x8000000d: 0x8020020,
    0x8000000e: 0x8000800,
    0x8000000f: 0x20000,
    0x10: 0x20820,
    0x11: 0x8020800,
    0x12: 0x20,
    0x13: 0x800,
    0x14: 0x8000800,
    0x15: 0x8000020,
    0x16: 0x8020020,
    0x17: 0x20000,
    0x18: 0x0,
    0x19: 0x20020,
    0x1a: 0x8020000,
    0x1b: 0x8000820,
    0x1c: 0x8020820,
    0x1d: 0x20800,
    0x1e: 0x820,
    0x1f: 0x8000000,
    0x80000010: 0x20000,
    0x80000011: 0x800,
    0x80000012: 0x8020020,
    0x80000013: 0x20820,
    0x80000014: 0x20,
    0x80000015: 0x8020000,
    0x80000016: 0x8000000,
    0x80000017: 0x8000820,
    0x80000018: 0x8020820,
    0x80000019: 0x8000020,
    0x8000001a: 0x8000800,
    0x8000001b: 0x0,
    0x8000001c: 0x20800,
    0x8000001d: 0x820,
    0x8000001e: 0x20020,
    0x8000001f: 0x8020800,
  },
];

// Masks that select the SBOX input
const SBOX_MASK = [
  0xf8000001, 0x1f800000, 0x01f80000, 0x001f8000,
  0x0001f800, 0x00001f80, 0x000001f8, 0x8000001f,
];

// Swap bits across the left and right words
function exchangeLR(offset, mask) {
  const t = ((this._lBlock >>> offset) ^ this._rBlock) & mask;
  this._rBlock ^= t;
  this._lBlock ^= t << offset;
}

function exchangeRL(offset, mask) {
  const t = ((this._rBlock >>> offset) ^ this._lBlock) & mask;
  this._lBlock ^= t;
  this._rBlock ^= t << offset;
}

/**
 * DES block cipher algorithm.
 */
class DESAlgo extends BlockCipher {
  _doReset() {
    // Shortcuts
    const key = this._key;
    const keyWords = key.words;

    // Select 56 bits according to PC1
    const keyBits = [];
    for (let i = 0; i < 56; i += 1) {
      const keyBitPos = PC1[i] - 1;
      keyBits[i] = (keyWords[keyBitPos >>> 5] >>> (31 - (keyBitPos % 32))) & 1;
    }

    // Assemble 16 subkeys
    this._subKeys = [];
    const subKeys = this._subKeys;
    for (let nSubKey = 0; nSubKey < 16; nSubKey += 1) {
      // Create subkey
      subKeys[nSubKey] = [];
      const subKey = subKeys[nSubKey];

      // Shortcut
      const bitShift = BIT_SHIFTS[nSubKey];

      // Select 48 bits according to PC2
      for (let i = 0; i < 24; i += 1) {
        // Select from the left 28 key bits
        subKey[(i / 6) | 0] |= keyBits[((PC2[i] - 1) + bitShift) % 28] << (31 - (i % 6));

        // Select from the right 28 key bits
        subKey[4 + ((i / 6) | 0)]
          |= keyBits[28 + (((PC2[i + 24] - 1) + bitShift) % 28)]
          << (31 - (i % 6));
      }

      // Since each subkey is applied to an expanded 32-bit input,
      // the subkey can be broken into 8 values scaled to 32-bits,
      // which allows the key to be used without expansion
      subKey[0] = (subKey[0] << 1) | (subKey[0] >>> 31);
      for (let i = 1; i < 7; i += 1) {
        subKey[i] >>>= ((i - 1) * 4 + 3);
      }
      subKey[7] = (subKey[7] << 5) | (subKey[7] >>> 27);
    }

    // Compute inverse subkeys
    this._invSubKeys = [];
    const invSubKeys = this._invSubKeys;
    for (let i = 0; i < 16; i += 1) {
      invSubKeys[i] = subKeys[15 - i];
    }
  }

  encryptBlock(M, offset) {
    this._doCryptBlock(M, offset, this._subKeys);
  }

  decryptBlock(M, offset) {
    this._doCryptBlock(M, offset, this._invSubKeys);
  }

  _doCryptBlock(M, offset, subKeys) {
    const _M = M;

    // Get input
    this._lBlock = M[offset];
    this._rBlock = M[offset + 1];

    // Initial permutation
    exchangeLR.call(this, 4, 0x0f0f0f0f);
    exchangeLR.call(this, 16, 0x0000ffff);
    exchangeRL.call(this, 2, 0x33333333);
    exchangeRL.call(this, 8, 0x00ff00ff);
    exchangeLR.call(this, 1, 0x55555555);

    // Rounds
    for (let round = 0; round < 16; round += 1) {
      // Shortcuts
      const subKey = subKeys[round];
      const lBlock = this._lBlock;
      const rBlock = this._rBlock;

      // Feistel function
      let f = 0;
      for (let i = 0; i < 8; i += 1) {
        f |= SBOX_P[i][((rBlock ^ subKey[i]) & SBOX_MASK[i]) >>> 0];
      }
      this._lBlock = rBlock;
      this._rBlock = lBlock ^ f;
    }

    // Undo swap from last round
    const t = this._lBlock;
    this._lBlock = this._rBlock;
    this._rBlock = t;

    // Final permutation
    exchangeLR.call(this, 1, 0x55555555);
    exchangeRL.call(this, 8, 0x00ff00ff);
    exchangeRL.call(this, 2, 0x33333333);
    exchangeLR.call(this, 16, 0x0000ffff);
    exchangeLR.call(this, 4, 0x0f0f0f0f);

    // Set output
    _M[offset] = this._lBlock;
    _M[offset + 1] = this._rBlock;
  }
}
DESAlgo.keySize = 64 / 32;
DESAlgo.ivSize = 64 / 32;
DESAlgo.blockSize = 64 / 32;

/**
 * Shortcut functions to the cipher's object interface.
 *
 * @example
 *
 *     var ciphertext = CryptoJS.DES.encrypt(message, key, cfg);
 *     var plaintext  = CryptoJS.DES.decrypt(ciphertext, key, cfg);
 */
const DES = BlockCipher._createHelper(DESAlgo);

/**
 * Triple-DES block cipher algorithm.
 */
class TripleDESAlgo extends BlockCipher {
  _doReset() {
    // Shortcuts
    const key = this._key;
    const keyWords = key.words;
    // Make sure the key length is valid (64, 128 or >= 192 bit)
    if (keyWords.length !== 2 && keyWords.length !== 4 && keyWords.length < 6) {
      throw new Error('Invalid key length - 3DES requires the key length to be 64, 128, 192 or >192.');
    }

    // Extend the key according to the keying options defined in 3DES standard
    const key1 = keyWords.slice(0, 2);
    const key2 = keyWords.length < 4 ? keyWords.slice(0, 2) : keyWords.slice(2, 4);
    const key3 = keyWords.length < 6 ? keyWords.slice(0, 2) : keyWords.slice(4, 6);

    // Create DES instances
    this._des1 = DESAlgo.createEncryptor(WordArray.create(key1));
    this._des2 = DESAlgo.createEncryptor(WordArray.create(key2));
    this._des3 = DESAlgo.createEncryptor(WordArray.create(key3));
  }

  encryptBlock(M, offset) {
    this._des1.encryptBlock(M, offset);
    this._des2.decryptBlock(M, offset);
    this._des3.encryptBlock(M, offset);
  }

  decryptBlock(M, offset) {
    this._des3.decryptBlock(M, offset);
    this._des2.encryptBlock(M, offset);
    this._des1.decryptBlock(M, offset);
  }
}
TripleDESAlgo.keySize = 192 / 32;
TripleDESAlgo.ivSize = 64 / 32;
TripleDESAlgo.blockSize = 64 / 32;

/**
 * Shortcut functions to the cipher's object interface.
 *
 * @example
 *
 *     var ciphertext = CryptoJS.TripleDES.encrypt(message, key, cfg);
 *     var plaintext  = CryptoJS.TripleDES.decrypt(ciphertext, key, cfg);
 */
const TripleDES = BlockCipher._createHelper(TripleDESAlgo);

// Reusable objects
const S$1 = [];
const C_$1 = [];
const G$1 = [];

function nextState$1() {
  // Shortcuts
  const X = this._X;
  const C = this._C;

  // Save old counter values
  for (let i = 0; i < 8; i += 1) {
    C_$1[i] = C[i];
  }

  // Calculate new counter values
  C[0] = (C[0] + 0x4d34d34d + this._b) | 0;
  C[1] = (C[1] + 0xd34d34d3 + ((C[0] >>> 0) < (C_$1[0] >>> 0) ? 1 : 0)) | 0;
  C[2] = (C[2] + 0x34d34d34 + ((C[1] >>> 0) < (C_$1[1] >>> 0) ? 1 : 0)) | 0;
  C[3] = (C[3] + 0x4d34d34d + ((C[2] >>> 0) < (C_$1[2] >>> 0) ? 1 : 0)) | 0;
  C[4] = (C[4] + 0xd34d34d3 + ((C[3] >>> 0) < (C_$1[3] >>> 0) ? 1 : 0)) | 0;
  C[5] = (C[5] + 0x34d34d34 + ((C[4] >>> 0) < (C_$1[4] >>> 0) ? 1 : 0)) | 0;
  C[6] = (C[6] + 0x4d34d34d + ((C[5] >>> 0) < (C_$1[5] >>> 0) ? 1 : 0)) | 0;
  C[7] = (C[7] + 0xd34d34d3 + ((C[6] >>> 0) < (C_$1[6] >>> 0) ? 1 : 0)) | 0;
  this._b = (C[7] >>> 0) < (C_$1[7] >>> 0) ? 1 : 0;

  // Calculate the g-values
  for (let i = 0; i < 8; i += 1) {
    const gx = X[i] + C[i];

    // Construct high and low argument for squaring
    const ga = gx & 0xffff;
    const gb = gx >>> 16;

    // Calculate high and low result of squaring
    const gh = ((((ga * ga) >>> 17) + ga * gb) >>> 15) + gb * gb;
    const gl = (((gx & 0xffff0000) * gx) | 0) + (((gx & 0x0000ffff) * gx) | 0);

    // High XOR low
    G$1[i] = gh ^ gl;
  }

  // Calculate new state values
  X[0] = (G$1[0] + ((G$1[7] << 16) | (G$1[7] >>> 16)) + ((G$1[6] << 16) | (G$1[6] >>> 16))) | 0;
  X[1] = (G$1[1] + ((G$1[0] << 8) | (G$1[0] >>> 24)) + G$1[7]) | 0;
  X[2] = (G$1[2] + ((G$1[1] << 16) | (G$1[1] >>> 16)) + ((G$1[0] << 16) | (G$1[0] >>> 16))) | 0;
  X[3] = (G$1[3] + ((G$1[2] << 8) | (G$1[2] >>> 24)) + G$1[1]) | 0;
  X[4] = (G$1[4] + ((G$1[3] << 16) | (G$1[3] >>> 16)) + ((G$1[2] << 16) | (G$1[2] >>> 16))) | 0;
  X[5] = (G$1[5] + ((G$1[4] << 8) | (G$1[4] >>> 24)) + G$1[3]) | 0;
  X[6] = (G$1[6] + ((G$1[5] << 16) | (G$1[5] >>> 16)) + ((G$1[4] << 16) | (G$1[4] >>> 16))) | 0;
  X[7] = (G$1[7] + ((G$1[6] << 8) | (G$1[6] >>> 24)) + G$1[5]) | 0;
}

/**
 * Rabbit stream cipher algorithm
 */
class RabbitAlgo extends StreamCipher {
  constructor(...args) {
    super(...args);

    this.blockSize = 128 / 32;
    this.ivSize = 64 / 32;
  }

  _doReset() {
    // Shortcuts
    const K = this._key.words;
    const { iv } = this.cfg;

    // Swap endian
    for (let i = 0; i < 4; i += 1) {
      K[i] = (((K[i] << 8) | (K[i] >>> 24)) & 0x00ff00ff)
        | (((K[i] << 24) | (K[i] >>> 8)) & 0xff00ff00);
    }

    // Generate initial state values
    this._X = [
      K[0], (K[3] << 16) | (K[2] >>> 16),
      K[1], (K[0] << 16) | (K[3] >>> 16),
      K[2], (K[1] << 16) | (K[0] >>> 16),
      K[3], (K[2] << 16) | (K[1] >>> 16),
    ];
    const X = this._X;

    // Generate initial counter values
    this._C = [
      (K[2] << 16) | (K[2] >>> 16), (K[0] & 0xffff0000) | (K[1] & 0x0000ffff),
      (K[3] << 16) | (K[3] >>> 16), (K[1] & 0xffff0000) | (K[2] & 0x0000ffff),
      (K[0] << 16) | (K[0] >>> 16), (K[2] & 0xffff0000) | (K[3] & 0x0000ffff),
      (K[1] << 16) | (K[1] >>> 16), (K[3] & 0xffff0000) | (K[0] & 0x0000ffff),
    ];
    const C = this._C;

    // Carry bit
    this._b = 0;

    // Iterate the system four times
    for (let i = 0; i < 4; i += 1) {
      nextState$1.call(this);
    }

    // Modify the counters
    for (let i = 0; i < 8; i += 1) {
      C[i] ^= X[(i + 4) & 7];
    }

    // IV setup
    if (iv) {
      // Shortcuts
      const IV = iv.words;
      const IV_0 = IV[0];
      const IV_1 = IV[1];

      // Generate four subvectors
      const i0 = (((IV_0 << 8) | (IV_0 >>> 24)) & 0x00ff00ff)
        | (((IV_0 << 24) | (IV_0 >>> 8)) & 0xff00ff00);
      const i2 = (((IV_1 << 8) | (IV_1 >>> 24)) & 0x00ff00ff)
        | (((IV_1 << 24) | (IV_1 >>> 8)) & 0xff00ff00);
      const i1 = (i0 >>> 16) | (i2 & 0xffff0000);
      const i3 = (i2 << 16) | (i0 & 0x0000ffff);

      // Modify counter values
      C[0] ^= i0;
      C[1] ^= i1;
      C[2] ^= i2;
      C[3] ^= i3;
      C[4] ^= i0;
      C[5] ^= i1;
      C[6] ^= i2;
      C[7] ^= i3;

      // Iterate the system four times
      for (let i = 0; i < 4; i += 1) {
        nextState$1.call(this);
      }
    }
  }

  _doProcessBlock(M, offset) {
    const _M = M;

    // Shortcut
    const X = this._X;

    // Iterate the system
    nextState$1.call(this);

    // Generate four keystream words
    S$1[0] = X[0] ^ (X[5] >>> 16) ^ (X[3] << 16);
    S$1[1] = X[2] ^ (X[7] >>> 16) ^ (X[5] << 16);
    S$1[2] = X[4] ^ (X[1] >>> 16) ^ (X[7] << 16);
    S$1[3] = X[6] ^ (X[3] >>> 16) ^ (X[1] << 16);

    for (let i = 0; i < 4; i += 1) {
      // Swap endian
      S$1[i] = (((S$1[i] << 8) | (S$1[i] >>> 24)) & 0x00ff00ff)
        | (((S$1[i] << 24) | (S$1[i] >>> 8)) & 0xff00ff00);

      // Encrypt
      _M[offset + i] ^= S$1[i];
    }
  }
}

/**
 * Shortcut functions to the cipher's object interface.
 *
 * @example
 *
 *     var ciphertext = CryptoJS.Rabbit.encrypt(message, key, cfg);
 *     var plaintext  = CryptoJS.Rabbit.decrypt(ciphertext, key, cfg);
 */
const Rabbit = StreamCipher._createHelper(RabbitAlgo);

// Reusable objects
const S = [];
const C_ = [];
const G = [];

function nextState() {
  // Shortcuts
  const X = this._X;
  const C = this._C;

  // Save old counter values
  for (let i = 0; i < 8; i += 1) {
    C_[i] = C[i];
  }

  // Calculate new counter values
  C[0] = (C[0] + 0x4d34d34d + this._b) | 0;
  C[1] = (C[1] + 0xd34d34d3 + ((C[0] >>> 0) < (C_[0] >>> 0) ? 1 : 0)) | 0;
  C[2] = (C[2] + 0x34d34d34 + ((C[1] >>> 0) < (C_[1] >>> 0) ? 1 : 0)) | 0;
  C[3] = (C[3] + 0x4d34d34d + ((C[2] >>> 0) < (C_[2] >>> 0) ? 1 : 0)) | 0;
  C[4] = (C[4] + 0xd34d34d3 + ((C[3] >>> 0) < (C_[3] >>> 0) ? 1 : 0)) | 0;
  C[5] = (C[5] + 0x34d34d34 + ((C[4] >>> 0) < (C_[4] >>> 0) ? 1 : 0)) | 0;
  C[6] = (C[6] + 0x4d34d34d + ((C[5] >>> 0) < (C_[5] >>> 0) ? 1 : 0)) | 0;
  C[7] = (C[7] + 0xd34d34d3 + ((C[6] >>> 0) < (C_[6] >>> 0) ? 1 : 0)) | 0;
  this._b = (C[7] >>> 0) < (C_[7] >>> 0) ? 1 : 0;

  // Calculate the g-values
  for (let i = 0; i < 8; i += 1) {
    const gx = X[i] + C[i];

    // Construct high and low argument for squaring
    const ga = gx & 0xffff;
    const gb = gx >>> 16;

    // Calculate high and low result of squaring
    const gh = ((((ga * ga) >>> 17) + ga * gb) >>> 15) + gb * gb;
    const gl = (((gx & 0xffff0000) * gx) | 0) + (((gx & 0x0000ffff) * gx) | 0);

    // High XOR low
    G[i] = gh ^ gl;
  }

  // Calculate new state values
  X[0] = (G[0] + ((G[7] << 16) | (G[7] >>> 16)) + ((G[6] << 16) | (G[6] >>> 16))) | 0;
  X[1] = (G[1] + ((G[0] << 8) | (G[0] >>> 24)) + G[7]) | 0;
  X[2] = (G[2] + ((G[1] << 16) | (G[1] >>> 16)) + ((G[0] << 16) | (G[0] >>> 16))) | 0;
  X[3] = (G[3] + ((G[2] << 8) | (G[2] >>> 24)) + G[1]) | 0;
  X[4] = (G[4] + ((G[3] << 16) | (G[3] >>> 16)) + ((G[2] << 16) | (G[2] >>> 16))) | 0;
  X[5] = (G[5] + ((G[4] << 8) | (G[4] >>> 24)) + G[3]) | 0;
  X[6] = (G[6] + ((G[5] << 16) | (G[5] >>> 16)) + ((G[4] << 16) | (G[4] >>> 16))) | 0;
  X[7] = (G[7] + ((G[6] << 8) | (G[6] >>> 24)) + G[5]) | 0;
}

/**
 * Rabbit stream cipher algorithm.
 *
 * This is a legacy version that neglected to convert the key to little-endian.
 * This error doesn't affect the cipher's security,
 * but it does affect its compatibility with other implementations.
 */
class RabbitLegacyAlgo extends StreamCipher {
  constructor(...args) {
    super(...args);

    this.blockSize = 128 / 32;
    this.ivSize = 64 / 32;
  }

  _doReset() {
    // Shortcuts
    const K = this._key.words;
    const { iv } = this.cfg;

    // Generate initial state values
    this._X = [
      K[0], (K[3] << 16) | (K[2] >>> 16),
      K[1], (K[0] << 16) | (K[3] >>> 16),
      K[2], (K[1] << 16) | (K[0] >>> 16),
      K[3], (K[2] << 16) | (K[1] >>> 16),
    ];
    const X = this._X;

    // Generate initial counter values
    this._C = [
      (K[2] << 16) | (K[2] >>> 16), (K[0] & 0xffff0000) | (K[1] & 0x0000ffff),
      (K[3] << 16) | (K[3] >>> 16), (K[1] & 0xffff0000) | (K[2] & 0x0000ffff),
      (K[0] << 16) | (K[0] >>> 16), (K[2] & 0xffff0000) | (K[3] & 0x0000ffff),
      (K[1] << 16) | (K[1] >>> 16), (K[3] & 0xffff0000) | (K[0] & 0x0000ffff),
    ];
    const C = this._C;

    // Carry bit
    this._b = 0;

    // Iterate the system four times
    for (let i = 0; i < 4; i += 1) {
      nextState.call(this);
    }

    // Modify the counters
    for (let i = 0; i < 8; i += 1) {
      C[i] ^= X[(i + 4) & 7];
    }

    // IV setup
    if (iv) {
      // Shortcuts
      const IV = iv.words;
      const IV_0 = IV[0];
      const IV_1 = IV[1];

      // Generate four subvectors
      const i0 = (((IV_0 << 8) | (IV_0 >>> 24)) & 0x00ff00ff)
        | (((IV_0 << 24) | (IV_0 >>> 8)) & 0xff00ff00);
      const i2 = (((IV_1 << 8) | (IV_1 >>> 24)) & 0x00ff00ff)
        | (((IV_1 << 24) | (IV_1 >>> 8)) & 0xff00ff00);
      const i1 = (i0 >>> 16) | (i2 & 0xffff0000);
      const i3 = (i2 << 16) | (i0 & 0x0000ffff);

      // Modify counter values
      C[0] ^= i0;
      C[1] ^= i1;
      C[2] ^= i2;
      C[3] ^= i3;
      C[4] ^= i0;
      C[5] ^= i1;
      C[6] ^= i2;
      C[7] ^= i3;

      // Iterate the system four times
      for (let i = 0; i < 4; i += 1) {
        nextState.call(this);
      }
    }
  }

  _doProcessBlock(M, offset) {
    const _M = M;

    // Shortcut
    const X = this._X;

    // Iterate the system
    nextState.call(this);

    // Generate four keystream words
    S[0] = X[0] ^ (X[5] >>> 16) ^ (X[3] << 16);
    S[1] = X[2] ^ (X[7] >>> 16) ^ (X[5] << 16);
    S[2] = X[4] ^ (X[1] >>> 16) ^ (X[7] << 16);
    S[3] = X[6] ^ (X[3] >>> 16) ^ (X[1] << 16);

    for (let i = 0; i < 4; i += 1) {
      // Swap endian
      S[i] = (((S[i] << 8) | (S[i] >>> 24)) & 0x00ff00ff)
        | (((S[i] << 24) | (S[i] >>> 8)) & 0xff00ff00);

      // Encrypt
      _M[offset + i] ^= S[i];
    }
  }
}

/**
 * Shortcut functions to the cipher's object interface.
 *
 * @example
 *
 *     var ciphertext = CryptoJS.RabbitLegacy.encrypt(message, key, cfg);
 *     var plaintext  = CryptoJS.RabbitLegacy.decrypt(ciphertext, key, cfg);
 */
const RabbitLegacy = StreamCipher._createHelper(RabbitLegacyAlgo);

function generateKeystreamWord() {
  // Shortcuts
  const S = this._S;
  let i = this._i;
  let j = this._j;

  // Generate keystream word
  let keystreamWord = 0;
  for (let n = 0; n < 4; n += 1) {
    i = (i + 1) % 256;
    j = (j + S[i]) % 256;

    // Swap
    const t = S[i];
    S[i] = S[j];
    S[j] = t;

    keystreamWord |= S[(S[i] + S[j]) % 256] << (24 - n * 8);
  }

  // Update counters
  this._i = i;
  this._j = j;

  return keystreamWord;
}

/**
 * RC4 stream cipher algorithm.
 */
class RC4Algo extends StreamCipher {
  _doReset() {
    // Shortcuts
    const key = this._key;
    const keyWords = key.words;
    const keySigBytes = key.sigBytes;

    // Init sbox
    this._S = [];
    const S = this._S;
    for (let i = 0; i < 256; i += 1) {
      S[i] = i;
    }

    // Key setup
    for (let i = 0, j = 0; i < 256; i += 1) {
      const keyByteIndex = i % keySigBytes;
      const keyByte = (keyWords[keyByteIndex >>> 2] >>> (24 - (keyByteIndex % 4) * 8)) & 0xff;

      j = (j + S[i] + keyByte) % 256;

      // Swap
      const t = S[i];
      S[i] = S[j];
      S[j] = t;
    }

    // Counters
    this._j = 0;
    this._i = this._j;
  }

  _doProcessBlock(M, offset) {
    const _M = M;

    _M[offset] ^= generateKeystreamWord.call(this);
  }
}
RC4Algo.keySize = 256 / 32;
RC4Algo.ivSize = 0;

/**
 * Shortcut functions to the cipher's object interface.
 *
 * @example
 *
 *     var ciphertext = CryptoJS.RC4.encrypt(message, key, cfg);
 *     var plaintext  = CryptoJS.RC4.decrypt(ciphertext, key, cfg);
 */
const RC4 = StreamCipher._createHelper(RC4Algo);

/**
 * Modified RC4 stream cipher algorithm.
 */
class RC4DropAlgo extends RC4Algo {
  constructor(...args) {
    super(...args);

    /**
     * Configuration options.
     *
     * @property {number} drop The number of keystream words to drop. Default 192
     */
    Object.assign(this.cfg, { drop: 192 });
  }

  _doReset() {
    super._doReset.call(this);

    // Drop
    for (let i = this.cfg.drop; i > 0; i -= 1) {
      generateKeystreamWord.call(this);
    }
  }
}

/**
 * Shortcut functions to the cipher's object interface.
 *
 * @example
 *
 *     var ciphertext = CryptoJS.RC4Drop.encrypt(message, key, cfg);
 *     var plaintext  = CryptoJS.RC4Drop.decrypt(ciphertext, key, cfg);
 */
const RC4Drop = StreamCipher._createHelper(RC4DropAlgo);

function generateKeystreamAndEncrypt(words, offset, blockSize, cipher) {
  const _words = words;
  let keystream;

  // Shortcut
  const iv = this._iv;

  // Generate keystream
  if (iv) {
    keystream = iv.slice(0);

    // Remove IV for subsequent blocks
    this._iv = undefined;
  } else {
    keystream = this._prevBlock;
  }
  cipher.encryptBlock(keystream, 0);

  // Encrypt
  for (let i = 0; i < blockSize; i += 1) {
    _words[offset + i] ^= keystream[i];
  }
}

/**
 * Cipher Feedback block mode.
 */
class CFB extends BlockCipherMode {
}
CFB.Encryptor = class extends CFB {
  processBlock(words, offset) {
    // Shortcuts
    const cipher = this._cipher;
    const { blockSize } = cipher;

    generateKeystreamAndEncrypt.call(this, words, offset, blockSize, cipher);

    // Remember this block to use with next block
    this._prevBlock = words.slice(offset, offset + blockSize);
  }
};
CFB.Decryptor = class extends CFB {
  processBlock(words, offset) {
    // Shortcuts
    const cipher = this._cipher;
    const { blockSize } = cipher;

    // Remember this block to use with next block
    const thisBlock = words.slice(offset, offset + blockSize);

    generateKeystreamAndEncrypt.call(this, words, offset, blockSize, cipher);

    // This block becomes the previous block
    this._prevBlock = thisBlock;
  }
};

/**
 * Counter block mode.
 */

class CTR extends BlockCipherMode {
}
CTR.Encryptor = class extends CTR {
  processBlock(words, offset) {
    const _words = words;

    // Shortcuts
    const cipher = this._cipher;
    const { blockSize } = cipher;
    const iv = this._iv;
    let counter = this._counter;

    // Generate keystream
    if (iv) {
      this._counter = iv.slice(0);
      counter = this._counter;

      // Remove IV for subsequent blocks
      this._iv = undefined;
    }
    const keystream = counter.slice(0);
    cipher.encryptBlock(keystream, 0);

    // Increment counter
    counter[blockSize - 1] = (counter[blockSize - 1] + 1) | 0;

    // Encrypt
    for (let i = 0; i < blockSize; i += 1) {
      _words[offset + i] ^= keystream[i];
    }
  }
};
CTR.Decryptor = CTR.Encryptor;

const incWord = (word) => {
  let _word = word;

  if (((word >> 24) & 0xff) === 0xff) { // overflow
    let b1 = (word >> 16) & 0xff;
    let b2 = (word >> 8) & 0xff;
    let b3 = word & 0xff;

    if (b1 === 0xff) { // overflow b1
      b1 = 0;
      if (b2 === 0xff) {
        b2 = 0;
        if (b3 === 0xff) {
          b3 = 0;
        } else {
          b3 += 1;
        }
      } else {
        b2 += 1;
      }
    } else {
      b1 += 1;
    }

    _word = 0;
    _word += (b1 << 16);
    _word += (b2 << 8);
    _word += b3;
  } else {
    _word += (0x01 << 24);
  }
  return _word;
};

const incCounter = (counter) => {
  const _counter = counter;
  _counter[0] = incWord(_counter[0]);

  if (_counter[0] === 0) {
    // encr_data in fileenc.c from  Dr Brian Gladman's counts only with DWORD j < 8
    _counter[1] = incWord(_counter[1]);
  }
  return _counter;
};

/** @preserve
 * Counter block mode compatible with  Dr Brian Gladman fileenc.c
 * derived from CryptoJS.mode.CTR
 * Jan Hruby jhruby.web@gmail.com
 */
class CTRGladman extends BlockCipherMode {
}
CTRGladman.Encryptor = class extends CTRGladman {
  processBlock(words, offset) {
    const _words = words;

    // Shortcuts
    const cipher = this._cipher;
    const { blockSize } = cipher;
    const iv = this._iv;
    let counter = this._counter;

    // Generate keystream
    if (iv) {
      this._counter = iv.slice(0);
      counter = this._counter;

      // Remove IV for subsequent blocks
      this._iv = undefined;
    }

    incCounter(counter);

    const keystream = counter.slice(0);
    cipher.encryptBlock(keystream, 0);

    // Encrypt
    for (let i = 0; i < blockSize; i += 1) {
      _words[offset + i] ^= keystream[i];
    }
  }
};
CTRGladman.Decryptor = CTRGladman.Encryptor;

/**
 * Electronic Codebook block mode.
 */

class ECB extends BlockCipherMode {
}
ECB.Encryptor = class extends ECB {
  processBlock(words, offset) {
    this._cipher.encryptBlock(words, offset);
  }
};
ECB.Decryptor = class extends ECB {
  processBlock(words, offset) {
    this._cipher.decryptBlock(words, offset);
  }
};

/**
 * Output Feedback block mode.
 */

class OFB extends BlockCipherMode {
}
OFB.Encryptor = class extends OFB {
  processBlock(words, offset) {
    const _words = words;

    // Shortcuts
    const cipher = this._cipher;
    const { blockSize } = cipher;
    const iv = this._iv;
    let keystream = this._keystream;

    // Generate keystream
    if (iv) {
      this._keystream = iv.slice(0);
      keystream = this._keystream;

      // Remove IV for subsequent blocks
      this._iv = undefined;
    }
    cipher.encryptBlock(keystream, 0);

    // Encrypt
    for (let i = 0; i < blockSize; i += 1) {
      _words[offset + i] ^= keystream[i];
    }
  }
};
OFB.Decryptor = OFB.Encryptor;

/**
 * ANSI X.923 padding strategy.
 */
const AnsiX923 = {
  pad(data, blockSize) {
    const _data = data;

    // Shortcuts
    const dataSigBytes = _data.sigBytes;
    const blockSizeBytes = blockSize * 4;

    // Count padding bytes
    const nPaddingBytes = blockSizeBytes - (dataSigBytes % blockSizeBytes);

    // Compute last byte position
    const lastBytePos = dataSigBytes + nPaddingBytes - 1;

    // Pad
    _data.clamp();
    _data.words[lastBytePos >>> 2] |= nPaddingBytes << (24 - (lastBytePos % 4) * 8);
    _data.sigBytes += nPaddingBytes;
  },

  unpad(data) {
    const _data = data;

    // Get number of padding bytes from last byte
    const nPaddingBytes = _data.words[(_data.sigBytes - 1) >>> 2] & 0xff;

    // Remove padding
    _data.sigBytes -= nPaddingBytes;
  },
};

/**
 * ISO 10126 padding strategy.
 */
const Iso10126 = {
  pad(data, blockSize) {
    // Shortcut
    const blockSizeBytes = blockSize * 4;

    // Count padding bytes
    const nPaddingBytes = blockSizeBytes - (data.sigBytes % blockSizeBytes);

    // Pad
    data
      .concat(WordArray.random(nPaddingBytes - 1))
      .concat(WordArray.create([nPaddingBytes << 24], 1));
  },

  unpad(data) {
    const _data = data;
    // Get number of padding bytes from last byte
    const nPaddingBytes = _data.words[(_data.sigBytes - 1) >>> 2] & 0xff;

    // Remove padding
    _data.sigBytes -= nPaddingBytes;
  },
};

/**
 * Zero padding strategy.
 */
const ZeroPadding = {
  pad(data, blockSize) {
    const _data = data;

    // Shortcut
    const blockSizeBytes = blockSize * 4;

    // Pad
    _data.clamp();
    _data.sigBytes += blockSizeBytes - ((data.sigBytes % blockSizeBytes) || blockSizeBytes);
  },

  unpad(data) {
    const _data = data;

    // Shortcut
    const dataWords = _data.words;

    // Unpad
    for (let i = _data.sigBytes - 1; i >= 0; i -= 1) {
      if (((dataWords[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff)) {
        _data.sigBytes = i + 1;
        break;
      }
    }
  },
};

/**
 * ISO/IEC 9797-1 Padding Method 2.
 */
const Iso97971 = {
  pad(data, blockSize) {
    // Add 0x80 byte
    data.concat(WordArray.create([0x80000000], 1));

    // Zero pad the rest
    ZeroPadding.pad(data, blockSize);
  },

  unpad(data) {
    const _data = data;

    // Remove zero padding
    ZeroPadding.unpad(_data);

    // Remove one more byte -- the 0x80 byte
    _data.sigBytes -= 1;
  },
};

/**
 * A noop padding strategy.
 */
const NoPadding = {
  pad() {
  },

  unpad() {
  },
};

const HexFormatter = {
  /**
   * Converts the ciphertext of a cipher params object to a hexadecimally encoded string.
   *
   * @param {CipherParams} cipherParams The cipher params object.
   *
   * @return {string} The hexadecimally encoded string.
   *
   * @static
   *
   * @example
   *
   *     var hexString = CryptoJS.format.Hex.stringify(cipherParams);
   */
  stringify(cipherParams) {
    return cipherParams.ciphertext.toString(Hex);
  },

  /**
   * Converts a hexadecimally encoded ciphertext string to a cipher params object.
   *
   * @param {string} input The hexadecimally encoded string.
   *
   * @return {CipherParams} The cipher params object.
   *
   * @static
   *
   * @example
   *
   *     var cipherParams = CryptoJS.format.Hex.parse(hexString);
   */
  parse(input) {
    const ciphertext = Hex.parse(input);
    return CipherParams.create({ ciphertext });
  },
};

var CryptoES = {
  lib: {
    Base,
    WordArray,
    BufferedBlockAlgorithm,
    Hasher,
    Cipher,
    StreamCipher,
    BlockCipherMode,
    BlockCipher,
    CipherParams,
    SerializableCipher,
    PasswordBasedCipher,
  },

  x64: {
    Word: X64Word,
    WordArray: X64WordArray,
  },

  enc: {
    Hex,
    Latin1,
    Utf8,
    Utf16,
    Utf16BE,
    Utf16LE,
    Base64,
  },

  algo: {
    HMAC,
    MD5: MD5Algo,
    SHA1: SHA1Algo,
    SHA224: SHA224Algo,
    SHA256: SHA256Algo,
    SHA384: SHA384Algo,
    SHA512: SHA512Algo,
    SHA3: SHA3Algo,
    RIPEMD160: RIPEMD160Algo,

    PBKDF2: PBKDF2Algo,
    EvpKDF: EvpKDFAlgo,

    AES: AESAlgo,
    DES: DESAlgo,
    TripleDES: TripleDESAlgo,
    Rabbit: RabbitAlgo,
    RabbitLegacy: RabbitLegacyAlgo,
    RC4: RC4Algo,
    RC4Drop: RC4DropAlgo,
  },

  mode: {
    CBC,
    CFB,
    CTR,
    CTRGladman,
    ECB,
    OFB,
  },

  pad: {
    Pkcs7,
    AnsiX923,
    Iso10126,
    Iso97971,
    NoPadding,
    ZeroPadding,
  },

  format: {
    OpenSSL: OpenSSLFormatter,
    Hex: HexFormatter,
  },

  kdf: {
    OpenSSL: OpenSSLKdf,
  },

  MD5,
  HmacMD5,
  SHA1,
  HmacSHA1,
  SHA224,
  HmacSHA224,
  SHA256,
  HmacSHA256,
  SHA384,
  HmacSHA384,
  SHA512,
  HmacSHA512,
  SHA3,
  HmacSHA3,
  RIPEMD160,
  HmacRIPEMD160,

  PBKDF2,
  EvpKDF,

  AES,
  DES,
  TripleDES,
  Rabbit,
  RabbitLegacy,
  RC4,
  RC4Drop,
};

class SecureModeCrypt {
    static encryptString(string, key) {
        return CryptoES.AES.encrypt(string, key).toString();
    }
    static decryptString(string, key) {
        return CryptoES.AES.decrypt(string, key).toString(CryptoES.enc.Utf8);
    }
}

function noop$2() { }
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
function is_empty(obj) {
    return Object.keys(obj).length === 0;
}

function append(target, node) {
    target.appendChild(node);
}
function insert(target, node, anchor) {
    target.insertBefore(node, anchor || null);
}
function detach(node) {
    node.parentNode.removeChild(node);
}
function destroy_each(iterations, detaching) {
    for (let i = 0; i < iterations.length; i += 1) {
        if (iterations[i])
            iterations[i].d(detaching);
    }
}
function element(name) {
    return document.createElement(name);
}
function text(data) {
    return document.createTextNode(data);
}
function space() {
    return text(' ');
}
function listen(node, event, handler, options) {
    node.addEventListener(event, handler, options);
    return () => node.removeEventListener(event, handler, options);
}
function attr(node, attribute, value) {
    if (value == null)
        node.removeAttribute(attribute);
    else if (node.getAttribute(attribute) !== value)
        node.setAttribute(attribute, value);
}
function children(element) {
    return Array.from(element.childNodes);
}
function set_data(text, data) {
    data = '' + data;
    if (text.wholeText !== data)
        text.data = data;
}
function set_input_value(input, value) {
    input.value = value == null ? '' : value;
}
function set_style(node, key, value, important) {
    node.style.setProperty(key, value, important ? 'important' : '');
}

let current_component;
function set_current_component(component) {
    current_component = component;
}

const dirty_components = [];
const binding_callbacks = [];
const render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = Promise.resolve();
let update_scheduled = false;
function schedule_update() {
    if (!update_scheduled) {
        update_scheduled = true;
        resolved_promise.then(flush);
    }
}
function add_render_callback(fn) {
    render_callbacks.push(fn);
}
let flushing = false;
const seen_callbacks = new Set();
function flush() {
    if (flushing)
        return;
    flushing = true;
    do {
        // first, call beforeUpdate functions
        // and update components
        for (let i = 0; i < dirty_components.length; i += 1) {
            const component = dirty_components[i];
            set_current_component(component);
            update(component.$$);
        }
        set_current_component(null);
        dirty_components.length = 0;
        while (binding_callbacks.length)
            binding_callbacks.pop()();
        // then, once components are updated, call
        // afterUpdate functions. This may cause
        // subsequent updates...
        for (let i = 0; i < render_callbacks.length; i += 1) {
            const callback = render_callbacks[i];
            if (!seen_callbacks.has(callback)) {
                // ...so guard against infinite loops
                seen_callbacks.add(callback);
                callback();
            }
        }
        render_callbacks.length = 0;
    } while (dirty_components.length);
    while (flush_callbacks.length) {
        flush_callbacks.pop()();
    }
    update_scheduled = false;
    flushing = false;
    seen_callbacks.clear();
}
function update($$) {
    if ($$.fragment !== null) {
        $$.update();
        run_all($$.before_update);
        const dirty = $$.dirty;
        $$.dirty = [-1];
        $$.fragment && $$.fragment.p($$.ctx, dirty);
        $$.after_update.forEach(add_render_callback);
    }
}
const outroing = new Set();
function transition_in(block, local) {
    if (block && block.i) {
        outroing.delete(block);
        block.i(local);
    }
}
function mount_component(component, target, anchor, customElement) {
    const { fragment, on_mount, on_destroy, after_update } = component.$$;
    fragment && fragment.m(target, anchor);
    if (!customElement) {
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
    }
    after_update.forEach(add_render_callback);
}
function destroy_component(component, detaching) {
    const $$ = component.$$;
    if ($$.fragment !== null) {
        run_all($$.on_destroy);
        $$.fragment && $$.fragment.d(detaching);
        // TODO null out other refs, including component.$$ (but need to
        // preserve final state?)
        $$.on_destroy = $$.fragment = null;
        $$.ctx = [];
    }
}
function make_dirty(component, i) {
    if (component.$$.dirty[0] === -1) {
        dirty_components.push(component);
        schedule_update();
        component.$$.dirty.fill(0);
    }
    component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
}
function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
    const parent_component = current_component;
    set_current_component(component);
    const $$ = component.$$ = {
        fragment: null,
        ctx: null,
        // state
        props,
        update: noop$2,
        not_equal,
        bound: blank_object(),
        // lifecycle
        on_mount: [],
        on_destroy: [],
        on_disconnect: [],
        before_update: [],
        after_update: [],
        context: new Map(parent_component ? parent_component.$$.context : options.context || []),
        // everything else
        callbacks: blank_object(),
        dirty,
        skip_bound: false
    };
    let ready = false;
    $$.ctx = instance
        ? instance(component, options.props || {}, (i, ret, ...rest) => {
            const value = rest.length ? rest[0] : ret;
            if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                if (!$$.skip_bound && $$.bound[i])
                    $$.bound[i](value);
                if (ready)
                    make_dirty(component, i);
            }
            return ret;
        })
        : [];
    $$.update();
    ready = true;
    run_all($$.before_update);
    // `false` as a special case of no DOM component
    $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
    if (options.target) {
        if (options.hydrate) {
            const nodes = children(options.target);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.l(nodes);
            nodes.forEach(detach);
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.c();
        }
        if (options.intro)
            transition_in(component.$$.fragment);
        mount_component(component, options.target, options.anchor, options.customElement);
        flush();
    }
    set_current_component(parent_component);
}
/**
 * Base class for Svelte components. Used when dev=false.
 */
class SvelteComponent {
    $destroy() {
        destroy_component(this, 1);
        this.$destroy = noop$2;
    }
    $on(type, callback) {
        const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
        callbacks.push(callback);
        return () => {
            const index = callbacks.indexOf(callback);
            if (index !== -1)
                callbacks.splice(index, 1);
        };
    }
    $set($$props) {
        if (this.$$set && !is_empty($$props)) {
            this.$$.skip_bound = true;
            this.$$set($$props);
            this.$$.skip_bound = false;
        }
    }
}

/* src/Modals/SecureModeSettingModal/SecureModeSettingModalContent.svelte generated by Svelte v3.37.0 */

function create_fragment$2(ctx) {
	let div1;
	let h1;
	let t1;
	let p;
	let t3;
	let div0;
	let t9;
	let label;
	let input;
	let t10;
	let button;
	let t11_value = (/*enable*/ ctx[0] ? "Encrypt!" : "Decrypt!") + "";
	let t11;
	let mounted;
	let dispose;

	return {
		c() {
			div1 = element("div");
			h1 = element("h1");
			h1.textContent = "Secure Mode Settings";
			t1 = space();
			p = element("p");
			p.textContent = "Please enter your password below and then click the button below.";
			t3 = space();
			div0 = element("div");

			div0.innerHTML = `Help
        <span class="tweetTooltipBody">Secure Mode enables you to encrypt your API keys with a password.
            The password will be required to use the plugin while Secure Mode is enabled.<br/>
            Your API keys will remain stored, but will be overwritten with the encrypted keys.
            This means they will be unintelligible to anyone who doesn&#39;t know your password.<br/> 
            <strong>Please do note that this plugin cannot check if your passwords decrypts your keys correctly!
            This means you might have to re-enter your keys if the wrong password is entered.</strong></span>`;

			t9 = space();
			label = element("label");
			input = element("input");
			t10 = space();
			button = element("button");
			t11 = text(t11_value);
			attr(div0, "class", "tweetTooltip");
			set_style(div0, "float", "right");
			attr(input, "type", "password");
			set_style(button, "margin-left", "1rem");
		},
		m(target, anchor) {
			insert(target, div1, anchor);
			append(div1, h1);
			append(div1, t1);
			append(div1, p);
			append(div1, t3);
			append(div1, div0);
			append(div1, t9);
			append(div1, label);
			append(label, input);
			set_input_value(input, /*passwordInput*/ ctx[2]);
			append(div1, t10);
			append(div1, button);
			append(button, t11);

			if (!mounted) {
				dispose = [
					listen(input, "input", /*input_input_handler*/ ctx[3]),
					listen(button, "click", /*click_handler*/ ctx[4])
				];

				mounted = true;
			}
		},
		p(ctx, [dirty]) {
			if (dirty & /*passwordInput*/ 4 && input.value !== /*passwordInput*/ ctx[2]) {
				set_input_value(input, /*passwordInput*/ ctx[2]);
			}

			if (dirty & /*enable*/ 1 && t11_value !== (t11_value = (/*enable*/ ctx[0] ? "Encrypt!" : "Decrypt!") + "")) set_data(t11, t11_value);
		},
		i: noop$2,
		o: noop$2,
		d(detaching) {
			if (detaching) detach(div1);
			mounted = false;
			run_all(dispose);
		}
	};
}

function instance$2($$self, $$props, $$invalidate) {
	let { enable } = $$props;
	let { onSubmit } = $$props;
	let passwordInput;

	function input_input_handler() {
		passwordInput = this.value;
		$$invalidate(2, passwordInput);
	}

	const click_handler = () => onSubmit(passwordInput);

	$$self.$$set = $$props => {
		if ("enable" in $$props) $$invalidate(0, enable = $$props.enable);
		if ("onSubmit" in $$props) $$invalidate(1, onSubmit = $$props.onSubmit);
	};

	return [enable, onSubmit, passwordInput, input_input_handler, click_handler];
}

class SecureModeSettingModalContent extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$2, create_fragment$2, safe_not_equal, { enable: 0, onSubmit: 1 });
	}
}

class SecureModeModal extends obsidian.Modal {
    constructor(app, plugin, enable) {
        super(app);
        this.userPressedCrypt = false;
        this.plugin = plugin;
        this.enable = enable;
        this.waitForResolve = new Promise((resolve) => (this.resolvePromise = resolve));
        this.secureModeSettingModalContent = new SecureModeSettingModalContent({
            target: this.contentEl,
            props: {
                enable: this.enable,
                userPressedCrypt: this.userPressedCrypt,
                onSubmit: (value) => this.onSubmit(value),
            },
        });
        this.open();
    }
    async onSubmit(value) {
        this.enable
            ? await this.encryptKeysWithPassword(value)
            : await this.decryptKeysWithPassword(value);
        this.userPressedCrypt = true;
        this.close();
    }
    onClose() {
        super.onClose();
        this.secureModeSettingModalContent.$destroy();
        this.resolvePromise();
    }
    async encryptKeysWithPassword(password) {
        this.plugin.settings.apiKey = SecureModeCrypt.encryptString(this.plugin.settings.apiKey, password);
        this.plugin.settings.apiSecret = SecureModeCrypt.encryptString(this.plugin.settings.apiSecret, password);
        this.plugin.settings.accessToken = SecureModeCrypt.encryptString(this.plugin.settings.accessToken, password);
        this.plugin.settings.accessTokenSecret = SecureModeCrypt.encryptString(this.plugin.settings.accessTokenSecret, password);
        await this.plugin.saveSettings();
    }
    async decryptKeysWithPassword(password) {
        this.plugin.settings.apiKey = SecureModeCrypt.decryptString(this.plugin.settings.apiKey, password);
        this.plugin.settings.apiSecret = SecureModeCrypt.decryptString(this.plugin.settings.apiSecret, password);
        this.plugin.settings.accessToken = SecureModeCrypt.decryptString(this.plugin.settings.accessToken, password);
        this.plugin.settings.accessTokenSecret = SecureModeCrypt.decryptString(this.plugin.settings.accessTokenSecret, password);
        await this.plugin.saveSettings();
    }
}

class NoteTweetScheduler {
}

class GenericInputPrompt extends obsidian.Modal {
    static Prompt(app, header, placeholder, value) {
        const newPromptModal = new GenericInputPrompt(app, header, placeholder, value);
        return newPromptModal.waitForClose;
    }
    constructor(app, header, placeholder, value) {
        super(app);
        this.header = header;
        this.didSubmit = false;
        this.waitForClose = new Promise((resolve, reject) => {
            this.resolvePromise = resolve;
            this.rejectPromise = reject;
        });
        this.open();
        this.display();
    }
    display() {
        this.contentEl.empty();
        this.addHeader();
        this.addInput();
    }
    onOpen() {
        super.onOpen();
    }
    onClose() {
        super.onClose();
        if (!this.didSubmit)
            this.rejectPromise("No input given.");
        else
            this.resolvePromise(this.input);
    }
    addHeader() {
        this.contentEl.createEl('h3', { text: this.header });
    }
    addInput() {
        const inputEl = new obsidian.TextComponent(this.contentEl);
        inputEl.setPlaceholder("today at 11:00");
        inputEl.inputEl.style.width = "100%";
        inputEl.inputEl.focus();
        inputEl.inputEl.select();
        inputEl.inputEl.addEventListener('keypress', ev => {
            if (ev.key === 'Enter') {
                this.resolvePromise(inputEl.getValue());
                this.didSubmit = true;
                this.close();
            }
        });
    }
}

async function promptForDateTime(app) {
    const input = await GenericInputPrompt.Prompt(app, "Update scheduled time");
    // @ts-ignore
    const nld = app.plugins.plugins["nldates-obsidian"].parser.chrono.parseDate(input);
    const nldparsed = Date.parse(nld);
    return new Date(nldparsed).getTime();
}

var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

function getDefaultExportFromCjs (x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
}

function createCommonjsModule(fn, basedir, module) {
	return module = {
		path: basedir,
		exports: {},
		require: function (path, base) {
			return commonjsRequire(path, (base === undefined || base === null) ? module.path : base);
		}
	}, fn(module, module.exports), module.exports;
}

function commonjsRequire () {
	throw new Error('Dynamic requires are not currently supported by @rollup/plugin-commonjs');
}

var rng_1 = createCommonjsModule(function (module, exports) {

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = rng;

var _crypto = _interopRequireDefault(require$$0__default["default"]);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const rnds8Pool = new Uint8Array(256); // # of random values to pre-allocate

let poolPtr = rnds8Pool.length;

function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    _crypto.default.randomFillSync(rnds8Pool);

    poolPtr = 0;
  }

  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}
});

var regex = createCommonjsModule(function (module, exports) {

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _default = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;
exports.default = _default;
});

var validate_1 = createCommonjsModule(function (module, exports) {

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _regex = _interopRequireDefault(regex);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function validate(uuid) {
  return typeof uuid === 'string' && _regex.default.test(uuid);
}

var _default = validate;
exports.default = _default;
});

var stringify_1 = createCommonjsModule(function (module, exports) {

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _validate = _interopRequireDefault(validate_1);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Convert array of 16 byte values to UUID string format of the form:
 * XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
 */
const byteToHex = [];

for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 0x100).toString(16).substr(1));
}

function stringify(arr, offset = 0) {
  // Note: Be careful editing this code!  It's been tuned for performance
  // and works in ways you may not expect. See https://github.com/uuidjs/uuid/pull/434
  const uuid = (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + '-' + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + '-' + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + '-' + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + '-' + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase(); // Consistency check for valid UUID.  If this throws, it's likely due to one
  // of the following:
  // - One or more input array values don't map to a hex octet (leading to
  // "undefined" in the uuid)
  // - Invalid input values for the RFC `version` or `variant` fields

  if (!(0, _validate.default)(uuid)) {
    throw TypeError('Stringified UUID is invalid');
  }

  return uuid;
}

var _default = stringify;
exports.default = _default;
});

var v1_1 = createCommonjsModule(function (module, exports) {

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _rng = _interopRequireDefault(rng_1);

var _stringify = _interopRequireDefault(stringify_1);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// **`v1()` - Generate time-based UUID**
//
// Inspired by https://github.com/LiosK/UUID.js
// and http://docs.python.org/library/uuid.html
let _nodeId;

let _clockseq; // Previous uuid creation time


let _lastMSecs = 0;
let _lastNSecs = 0; // See https://github.com/uuidjs/uuid for API details

function v1(options, buf, offset) {
  let i = buf && offset || 0;
  const b = buf || new Array(16);
  options = options || {};
  let node = options.node || _nodeId;
  let clockseq = options.clockseq !== undefined ? options.clockseq : _clockseq; // node and clockseq need to be initialized to random values if they're not
  // specified.  We do this lazily to minimize issues related to insufficient
  // system entropy.  See #189

  if (node == null || clockseq == null) {
    const seedBytes = options.random || (options.rng || _rng.default)();

    if (node == null) {
      // Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
      node = _nodeId = [seedBytes[0] | 0x01, seedBytes[1], seedBytes[2], seedBytes[3], seedBytes[4], seedBytes[5]];
    }

    if (clockseq == null) {
      // Per 4.2.2, randomize (14 bit) clockseq
      clockseq = _clockseq = (seedBytes[6] << 8 | seedBytes[7]) & 0x3fff;
    }
  } // UUID timestamps are 100 nano-second units since the Gregorian epoch,
  // (1582-10-15 00:00).  JSNumbers aren't precise enough for this, so
  // time is handled internally as 'msecs' (integer milliseconds) and 'nsecs'
  // (100-nanoseconds offset from msecs) since unix epoch, 1970-01-01 00:00.


  let msecs = options.msecs !== undefined ? options.msecs : Date.now(); // Per 4.2.1.2, use count of uuid's generated during the current clock
  // cycle to simulate higher resolution clock

  let nsecs = options.nsecs !== undefined ? options.nsecs : _lastNSecs + 1; // Time since last uuid creation (in msecs)

  const dt = msecs - _lastMSecs + (nsecs - _lastNSecs) / 10000; // Per 4.2.1.2, Bump clockseq on clock regression

  if (dt < 0 && options.clockseq === undefined) {
    clockseq = clockseq + 1 & 0x3fff;
  } // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new
  // time interval


  if ((dt < 0 || msecs > _lastMSecs) && options.nsecs === undefined) {
    nsecs = 0;
  } // Per 4.2.1.2 Throw error if too many uuids are requested


  if (nsecs >= 10000) {
    throw new Error("uuid.v1(): Can't create more than 10M uuids/sec");
  }

  _lastMSecs = msecs;
  _lastNSecs = nsecs;
  _clockseq = clockseq; // Per 4.1.4 - Convert from unix epoch to Gregorian epoch

  msecs += 12219292800000; // `time_low`

  const tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
  b[i++] = tl >>> 24 & 0xff;
  b[i++] = tl >>> 16 & 0xff;
  b[i++] = tl >>> 8 & 0xff;
  b[i++] = tl & 0xff; // `time_mid`

  const tmh = msecs / 0x100000000 * 10000 & 0xfffffff;
  b[i++] = tmh >>> 8 & 0xff;
  b[i++] = tmh & 0xff; // `time_high_and_version`

  b[i++] = tmh >>> 24 & 0xf | 0x10; // include version

  b[i++] = tmh >>> 16 & 0xff; // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)

  b[i++] = clockseq >>> 8 | 0x80; // `clock_seq_low`

  b[i++] = clockseq & 0xff; // `node`

  for (let n = 0; n < 6; ++n) {
    b[i + n] = node[n];
  }

  return buf || (0, _stringify.default)(b);
}

var _default = v1;
exports.default = _default;
});

var parse_1 = createCommonjsModule(function (module, exports) {

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _validate = _interopRequireDefault(validate_1);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function parse(uuid) {
  if (!(0, _validate.default)(uuid)) {
    throw TypeError('Invalid UUID');
  }

  let v;
  const arr = new Uint8Array(16); // Parse ########-....-....-....-............

  arr[0] = (v = parseInt(uuid.slice(0, 8), 16)) >>> 24;
  arr[1] = v >>> 16 & 0xff;
  arr[2] = v >>> 8 & 0xff;
  arr[3] = v & 0xff; // Parse ........-####-....-....-............

  arr[4] = (v = parseInt(uuid.slice(9, 13), 16)) >>> 8;
  arr[5] = v & 0xff; // Parse ........-....-####-....-............

  arr[6] = (v = parseInt(uuid.slice(14, 18), 16)) >>> 8;
  arr[7] = v & 0xff; // Parse ........-....-....-####-............

  arr[8] = (v = parseInt(uuid.slice(19, 23), 16)) >>> 8;
  arr[9] = v & 0xff; // Parse ........-....-....-....-############
  // (Use "/" to avoid 32-bit truncation when bit-shifting high-order bytes)

  arr[10] = (v = parseInt(uuid.slice(24, 36), 16)) / 0x10000000000 & 0xff;
  arr[11] = v / 0x100000000 & 0xff;
  arr[12] = v >>> 24 & 0xff;
  arr[13] = v >>> 16 & 0xff;
  arr[14] = v >>> 8 & 0xff;
  arr[15] = v & 0xff;
  return arr;
}

var _default = parse;
exports.default = _default;
});

var v35 = createCommonjsModule(function (module, exports) {

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = _default;
exports.URL = exports.DNS = void 0;

var _stringify = _interopRequireDefault(stringify_1);

var _parse = _interopRequireDefault(parse_1);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function stringToBytes(str) {
  str = unescape(encodeURIComponent(str)); // UTF8 escape

  const bytes = [];

  for (let i = 0; i < str.length; ++i) {
    bytes.push(str.charCodeAt(i));
  }

  return bytes;
}

const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
exports.DNS = DNS;
const URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
exports.URL = URL;

function _default(name, version, hashfunc) {
  function generateUUID(value, namespace, buf, offset) {
    if (typeof value === 'string') {
      value = stringToBytes(value);
    }

    if (typeof namespace === 'string') {
      namespace = (0, _parse.default)(namespace);
    }

    if (namespace.length !== 16) {
      throw TypeError('Namespace must be array-like (16 iterable integer values, 0-255)');
    } // Compute hash of namespace and value, Per 4.3
    // Future: Use spread syntax when supported on all platforms, e.g. `bytes =
    // hashfunc([...namespace, ... value])`


    let bytes = new Uint8Array(16 + value.length);
    bytes.set(namespace);
    bytes.set(value, namespace.length);
    bytes = hashfunc(bytes);
    bytes[6] = bytes[6] & 0x0f | version;
    bytes[8] = bytes[8] & 0x3f | 0x80;

    if (buf) {
      offset = offset || 0;

      for (let i = 0; i < 16; ++i) {
        buf[offset + i] = bytes[i];
      }

      return buf;
    }

    return (0, _stringify.default)(bytes);
  } // Function#name is not settable on some platforms (#270)


  try {
    generateUUID.name = name; // eslint-disable-next-line no-empty
  } catch (err) {} // For CommonJS default export support


  generateUUID.DNS = DNS;
  generateUUID.URL = URL;
  return generateUUID;
}
});

var md5_1 = createCommonjsModule(function (module, exports) {

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _crypto = _interopRequireDefault(require$$0__default["default"]);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function md5(bytes) {
  if (Array.isArray(bytes)) {
    bytes = Buffer.from(bytes);
  } else if (typeof bytes === 'string') {
    bytes = Buffer.from(bytes, 'utf8');
  }

  return _crypto.default.createHash('md5').update(bytes).digest();
}

var _default = md5;
exports.default = _default;
});

var v3_1 = createCommonjsModule(function (module, exports) {

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _v = _interopRequireDefault(v35);

var _md = _interopRequireDefault(md5_1);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const v3 = (0, _v.default)('v3', 0x30, _md.default);
var _default = v3;
exports.default = _default;
});

var v4_1 = createCommonjsModule(function (module, exports) {

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _rng = _interopRequireDefault(rng_1);

var _stringify = _interopRequireDefault(stringify_1);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function v4(options, buf, offset) {
  options = options || {};

  const rnds = options.random || (options.rng || _rng.default)(); // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`


  rnds[6] = rnds[6] & 0x0f | 0x40;
  rnds[8] = rnds[8] & 0x3f | 0x80; // Copy bytes to buffer, if provided

  if (buf) {
    offset = offset || 0;

    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }

    return buf;
  }

  return (0, _stringify.default)(rnds);
}

var _default = v4;
exports.default = _default;
});

var sha1_1 = createCommonjsModule(function (module, exports) {

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _crypto = _interopRequireDefault(require$$0__default["default"]);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function sha1(bytes) {
  if (Array.isArray(bytes)) {
    bytes = Buffer.from(bytes);
  } else if (typeof bytes === 'string') {
    bytes = Buffer.from(bytes, 'utf8');
  }

  return _crypto.default.createHash('sha1').update(bytes).digest();
}

var _default = sha1;
exports.default = _default;
});

var v5_1 = createCommonjsModule(function (module, exports) {

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _v = _interopRequireDefault(v35);

var _sha = _interopRequireDefault(sha1_1);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const v5 = (0, _v.default)('v5', 0x50, _sha.default);
var _default = v5;
exports.default = _default;
});

var nil = createCommonjsModule(function (module, exports) {

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _default = '00000000-0000-0000-0000-000000000000';
exports.default = _default;
});

var version_1 = createCommonjsModule(function (module, exports) {

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _validate = _interopRequireDefault(validate_1);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function version(uuid) {
  if (!(0, _validate.default)(uuid)) {
    throw TypeError('Invalid UUID');
  }

  return parseInt(uuid.substr(14, 1), 16);
}

var _default = version;
exports.default = _default;
});

var dist$1 = createCommonjsModule(function (module, exports) {

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "v1", {
  enumerable: true,
  get: function () {
    return _v.default;
  }
});
Object.defineProperty(exports, "v3", {
  enumerable: true,
  get: function () {
    return _v2.default;
  }
});
Object.defineProperty(exports, "v4", {
  enumerable: true,
  get: function () {
    return _v3.default;
  }
});
Object.defineProperty(exports, "v5", {
  enumerable: true,
  get: function () {
    return _v4.default;
  }
});
Object.defineProperty(exports, "NIL", {
  enumerable: true,
  get: function () {
    return _nil.default;
  }
});
Object.defineProperty(exports, "version", {
  enumerable: true,
  get: function () {
    return _version.default;
  }
});
Object.defineProperty(exports, "validate", {
  enumerable: true,
  get: function () {
    return _validate.default;
  }
});
Object.defineProperty(exports, "stringify", {
  enumerable: true,
  get: function () {
    return _stringify.default;
  }
});
Object.defineProperty(exports, "parse", {
  enumerable: true,
  get: function () {
    return _parse.default;
  }
});

var _v = _interopRequireDefault(v1_1);

var _v2 = _interopRequireDefault(v3_1);

var _v3 = _interopRequireDefault(v4_1);

var _v4 = _interopRequireDefault(v5_1);

var _nil = _interopRequireDefault(nil);

var _version = _interopRequireDefault(version_1);

var _validate = _interopRequireDefault(validate_1);

var _stringify = _interopRequireDefault(stringify_1);

var _parse = _interopRequireDefault(parse_1);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
});

class Tweet {
    constructor(tweet) {
        this.content = tweet;
        this.id = dist$1.v4();
    }
}

class ScheduledTweet extends Tweet {
    constructor(tweets, postat) {
        super(tweets);
        this.postat = postat;
    }
}

class PostTweetModal extends obsidian.Modal {
    constructor(app, selection) {
        super(app);
        this.textAreas = [];
        this.MAX_TWEET_LENGTH = 280;
        this.helpText = `Please read the documentation on the Github repository.
                        Click <a target="_blank" href="https://github.com/chhoumann/notetweet_obsidian">here</a> to go there.
                        There are lots of shortcuts and features to explore 😁`;
        this.resolved = false;
        this.selectedText = selection !== null && selection !== void 0 ? selection : { text: "", thread: false };
        this.newTweet = new Promise(((resolve, reject) => {
            this.resolve = (tweet => {
                resolve(tweet);
                this.resolved = true;
            });
            this.reject = reject;
        }));
    }
    onOpen() {
        let { contentEl } = this;
        contentEl.addClass("postTweetModal");
        this.addTooltip("Help", this.helpText, contentEl);
        this.textZone = contentEl.createDiv();
        try {
            this.createFirstTextarea();
            let addTweetButton = contentEl.createEl("button", { text: "+" });
            addTweetButton.addEventListener("click", () => this.createTextarea(this.textZone));
            this.addActionButtons();
        }
        catch (e) {
            log.logWarning(e);
            this.close();
            return;
        }
    }
    createFirstTextarea() {
        const textArea = this.createTextarea(this.textZone);
        if (this.selectedText.text.length > 0)
            this.insertTweetsFromSelectedText(textArea, this.textZone);
    }
    insertTweetsFromSelectedText(textArea, textZone) {
        let joinedTextChunks;
        if (this.selectedText.thread == false)
            joinedTextChunks = this.textInputHandler(this.selectedText.text);
        else
            joinedTextChunks = this.selectedText.text.split("--nt_sep--");
        this.createTweetsWithInput(joinedTextChunks, textArea, textZone);
    }
    createTweetsWithInput(inputStrings, currentTextArea, textZone) {
        inputStrings.forEach((chunk) => {
            try {
                let tempTextarea = currentTextArea.value.trim() == ""
                    ? currentTextArea
                    : this.createTextarea(textZone);
                tempTextarea.setRangeText(chunk);
                tempTextarea.trigger('input');
                tempTextarea.style.height = tempTextarea.scrollHeight + "px";
            }
            catch (e) {
                log.logWarning(e);
                return;
            }
        });
    }
    // Separate lines by linebreaks. Add lines together, separated by linebreak, if they can fit within a tweet.
    // Repeat this until all separated lines are joined into tweets with proper sizes.
    textInputHandler(str) {
        let chunks = str.split("\n");
        let i = 0, joinedTextChunks = [];
        chunks.forEach((chunk, j) => {
            if (joinedTextChunks[i] == null)
                joinedTextChunks[i] = "";
            if (joinedTextChunks[i].length + chunk.length <=
                this.MAX_TWEET_LENGTH - 1) {
                joinedTextChunks[i] = joinedTextChunks[i] + chunk;
                joinedTextChunks[i] += j == chunks.length - 1 ? "" : "\n";
            }
            else {
                if (chunk.length > this.MAX_TWEET_LENGTH) {
                    let x = chunk.split(/[.?!]\s/).join("\n");
                    this.textInputHandler(x).forEach((split) => (joinedTextChunks[++i] = split));
                }
                else {
                    joinedTextChunks[++i] = chunk;
                }
            }
        });
        return joinedTextChunks;
    }
    onClose() {
        let { contentEl } = this;
        contentEl.empty();
    }
    createTextarea(textZone) {
        if (this.textAreas.find((ele) => ele.textLength == 0)) {
            throw new Error("You cannot add a new tweet when there are empty tweets.");
        }
        let textarea = textZone.createEl("textarea");
        this.textAreas.push(textarea);
        textarea.addClass("tweetArea");
        let lengthCheckerEl = textZone.createEl("p", {
            text: "0 / 280 characters.",
        });
        lengthCheckerEl.addClass("ntLengthChecker");
        textarea.addEventListener("input", () => this.onTweetLengthHandler(textarea.textLength, lengthCheckerEl));
        textarea.addEventListener("keydown", this.onInput(textarea, textZone, lengthCheckerEl));
        textarea.addEventListener("paste", this.onPasteMaxLengthHandler(textarea, textZone));
        textarea.focus();
        return textarea;
    }
    addTooltip(title, body, root) {
        let tooltip = root.createEl("div", { text: title });
        let tooltipBody = tooltip.createEl("span");
        tooltipBody.innerHTML = body;
        tooltip.addClass("tweetTooltip");
        tooltipBody.addClass("tweetTooltipBody");
    }
    onPasteMaxLengthHandler(textarea, textZone) {
        return (event) => {
            let pasted = event.clipboardData.getData("text");
            if (pasted.length + textarea.textLength > this.MAX_TWEET_LENGTH) {
                event.preventDefault();
                let splicedPaste = this.textInputHandler(pasted);
                this.createTweetsWithInput(splicedPaste, textarea, textZone);
            }
        };
    }
    onInput(textarea, textZone, lengthCheckerEl) {
        return (key) => {
            if (key.code == "Backspace" &&
                textarea.textLength == 0 &&
                this.textAreas.length > 1) {
                key.preventDefault();
                this.deleteTweet(textarea, textZone, lengthCheckerEl);
            }
            if (key.code == "Enter" && textarea.textLength >= this.MAX_TWEET_LENGTH) {
                key.preventDefault();
                try {
                    this.createTextarea(textZone);
                }
                catch (e) {
                    log.logWarning(e);
                    return;
                }
            }
            if ((key.code == "Enter" || key.code == "NumpadEnter") && key.altKey) {
                key.preventDefault();
                try {
                    this.createTextarea(textZone);
                }
                catch (e) {
                    log.logWarning(e);
                    return;
                }
            }
            if (key.code == "Enter" && key.shiftKey) {
                key.preventDefault();
                this.insertTweetAbove(textarea, textZone);
            }
            if (key.code == "Enter" && key.ctrlKey) {
                key.preventDefault();
                this.insertTweetBelow(textarea, textZone);
            }
            if (key.code == "ArrowUp" && key.ctrlKey && !key.shiftKey) {
                let currentTweetIndex = this.textAreas.findIndex((tweet) => tweet.value == textarea.value);
                if (currentTweetIndex > 0)
                    this.textAreas[currentTweetIndex - 1].focus();
            }
            if (key.code == "ArrowDown" && key.ctrlKey && !key.shiftKey) {
                let currentTweetIndex = this.textAreas.findIndex((tweet) => tweet.value == textarea.value);
                if (currentTweetIndex < this.textAreas.length - 1)
                    this.textAreas[currentTweetIndex + 1].focus();
            }
            if (key.code == "ArrowDown" && key.ctrlKey && key.shiftKey) {
                let tweetIndex = this.textAreas.findIndex((ta) => ta.value == textarea.value);
                if (tweetIndex != this.textAreas.length - 1) {
                    key.preventDefault();
                    this.switchTweets(textarea, this.textAreas[tweetIndex + 1]);
                    this.textAreas[tweetIndex + 1].focus();
                }
            }
            if (key.code == "ArrowUp" && key.ctrlKey && key.shiftKey) {
                let tweetIndex = this.textAreas.findIndex((ta) => ta.value == textarea.value);
                if (tweetIndex != 0) {
                    key.preventDefault();
                    this.switchTweets(textarea, this.textAreas[tweetIndex - 1]);
                    this.textAreas[tweetIndex - 1].focus();
                }
            }
            if (key.code == "Delete" && key.ctrlKey && key.shiftKey) {
                key.preventDefault();
                if (this.textAreas.length == 1)
                    textarea.value = "";
                else
                    this.deleteTweet(textarea, textZone, lengthCheckerEl);
            }
            textarea.style.height = "auto";
            textarea.style.height = textarea.scrollHeight + "px";
        };
    }
    switchTweets(textarea1, textarea2) {
        let temp = textarea1.value;
        textarea1.value = textarea2.value;
        textarea2.value = temp;
        textarea1.dispatchEvent(new InputEvent("input"));
        textarea2.dispatchEvent(new InputEvent("input"));
    }
    deleteTweet(textarea, textZone, lengthCheckerEl) {
        let i = this.textAreas.findIndex((ele) => ele === textarea);
        this.textAreas.remove(textarea);
        textZone.removeChild(textarea);
        textZone.removeChild(lengthCheckerEl);
        this.textAreas[i == 0 ? i : i - 1].focus();
    }
    onTweetLengthHandler(strlen, lengthCheckerEl) {
        const WARN1 = this.MAX_TWEET_LENGTH - 50;
        const WARN2 = this.MAX_TWEET_LENGTH - 25;
        const DEFAULT_COLOR = "#339900";
        lengthCheckerEl.innerText = `${strlen} / 280 characters.`;
        if (strlen <= WARN1)
            lengthCheckerEl.style.color = DEFAULT_COLOR;
        if (strlen > WARN1)
            lengthCheckerEl.style.color = "#ffcc00";
        if (strlen > WARN2)
            lengthCheckerEl.style.color = "#ff9966";
        if (strlen >= this.MAX_TWEET_LENGTH) {
            lengthCheckerEl.style.color = "#cc3300";
        }
    }
    insertTweetAbove(textarea, textZone) {
        let insertAboveIndex = this.textAreas.findIndex((area) => area.value == textarea.value);
        try {
            let insertedTweet = this.createTextarea(textZone);
            this.shiftTweetsDownFromIndex(insertAboveIndex);
            return { tweet: insertedTweet, index: insertAboveIndex };
        }
        catch (e) {
            log.logWarning(e);
            return;
        }
    }
    insertTweetBelow(textarea, textZone) {
        let insertBelowIndex = this.textAreas.findIndex((area) => area.value == textarea.value);
        let fromIndex = insertBelowIndex + 1;
        try {
            let insertedTextarea = this.createTextarea(textZone);
            this.shiftTweetsDownFromIndex(fromIndex);
            return insertedTextarea;
        }
        catch (e) {
            log.logWarning(e);
        }
    }
    shiftTweetsDownFromIndex(insertedIndex) {
        for (let i = this.textAreas.length - 1; i > insertedIndex; i--) {
            this.textAreas[i].value = this.textAreas[i - 1].value;
            this.textAreas[i].dispatchEvent(new InputEvent("input"));
        }
        this.textAreas[insertedIndex].value = "";
        this.textAreas[insertedIndex].focus();
    }
    getThreadContent() {
        let threadContent = this.textAreas.map((textarea) => textarea.value);
        if (threadContent.find((txt) => txt.length > this.MAX_TWEET_LENGTH || txt == "") != null) {
            log.logWarning("At least one of your tweets is too long or empty.");
            return null;
        }
        return threadContent;
    }
}

class UpdateScheduledTweetModal extends PostTweetModal {
    static Update(app, tweet) {
        const modal = new UpdateScheduledTweetModal(app, tweet);
        modal.open();
        return modal.newTweet;
    }
    constructor(app, tweet) {
        super(app);
        this.tweet = tweet;
    }
    createFirstTextarea() {
        const textarea = this.createTextarea(this.textZone);
        this.createTweetsWithInput(this.tweet.content, textarea, this.textZone);
    }
    addActionButtons() {
        this.createScheduleButton(this.contentEl);
    }
    createScheduleButton(contentEl) {
        const scheduleButton = contentEl.createEl('button', { text: 'Update' });
        scheduleButton.addClass("postTweetButton");
        scheduleButton.addEventListener('click', this.updateScheduledTweet());
    }
    updateScheduledTweet() {
        return async () => {
            const threadContent = this.getThreadContent();
            if (!threadContent)
                return;
            const tweet = Object.assign(Object.assign({}, this.tweet), { content: threadContent });
            this.resolve(tweet);
            this.close();
        };
    }
}

class ScheduledTweetsModal extends obsidian.Modal {
    constructor(app, scheduler) {
        super(app);
        this.scheduler = scheduler;
    }
    async display() {
        var _a;
        this.contentEl.empty();
        this.contentEl.addClass('postTweetModal');
        const scheduledTweets = await this.scheduler.getScheduledTweets();
        const heading = this.contentEl.createEl('h2', { text: `Scheduled tweets (${(_a = scheduledTweets === null || scheduledTweets === void 0 ? void 0 : scheduledTweets.length) !== null && _a !== void 0 ? _a : 0})` });
        heading.style.marginBottom = "0";
        if (scheduledTweets.length === 0) {
            this.contentEl.createEl('p', { text: "No scheduled tweets. Go write some! 😁" });
        }
        else {
            const scheduledTweetsContainer = this.contentEl.createDiv('scheduledTweetsContainer');
            scheduledTweets.forEach(tweet => {
                this.addTweetRow(tweet, scheduledTweetsContainer);
            });
        }
    }
    addTweetRow(tweet, container) {
        const rowContainer = container.createDiv('scheduledTweet');
        tweet.content.forEach((item, i) => {
            const tweetContainer = rowContainer.createDiv('tweetContainer');
            const tweetItem = tweetContainer.createEl('span');
            tweetItem.innerText = item;
        });
        const tweetPostAt = rowContainer.createEl('p');
        tweetPostAt.textContent = `Scheduled for: ${window.moment(tweet.postat).format("DD-MM-YYYY HH:mm")}`;
        const buttonRowContainer = rowContainer.createDiv();
        buttonRowContainer.style.display = "flex";
        buttonRowContainer.style.alignContent = "center";
        buttonRowContainer.style.justifyContent = "space-between";
        const deleteButton = new obsidian.ButtonComponent(buttonRowContainer);
        deleteButton.setButtonText("Delete")
            .onClick(async () => {
            await this.scheduler.deleteScheduledTweet(tweet);
            await this.display();
        });
        const updateScheduledTweetButtonsContainer = buttonRowContainer.createDiv('updateScheduledTweetButtonsContainer');
        const updateScheduledTimeButton = new obsidian.ButtonComponent(updateScheduledTweetButtonsContainer);
        updateScheduledTimeButton.setCta().setButtonText("Update scheduled time")
            .onClick(async () => {
            tweet.postat = await promptForDateTime(this.app);
            await this.scheduler.updateTweet(tweet);
            await this.display();
        });
        const editTweetButton = new obsidian.ButtonComponent(updateScheduledTweetButtonsContainer);
        editTweetButton.setCta().setButtonText("Edit")
            .onClick(async () => {
            const updatedTweet = await UpdateScheduledTweetModal.Update(this.app, tweet);
            await this.scheduler.updateTweet(updatedTweet);
            await this.display();
        });
    }
    async onOpen() {
        super.onOpen();
        await this.display();
    }
}

const DEFAULT_SETTINGS = Object.freeze({
    apiKey: "",
    apiSecret: "",
    accessToken: "",
    accessTokenSecret: "",
    postTweetTag: "",
    secureMode: false,
    scheduling: { enabled: false, url: "", password: "", cronStrings: [] },
});
class NoteTweetSettingsTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    checkStatus() {
        this.statusIndicator.innerHTML = `<strong>Plugin Status:</strong> ${this.plugin.twitterHandler.isConnectedToTwitter
            ? "✅ Plugin connected to Twitter."
            : "🛑 Plugin not connected to Twitter."}`;
    }
    display() {
        let { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "NoteTweet" });
        this.statusIndicator = containerEl.createEl("p");
        this.checkStatus();
        this.addApiKeySetting();
        this.addApiSecretSetting();
        this.addAccessTokenSetting();
        this.addAccessTokenSecretSetting();
        this.addTweetTagSetting();
        this.addSecureModeSetting();
        this.addSchedulerSetting();
    }
    addSecureModeSetting() {
        new obsidian.Setting(this.containerEl)
            .setName("Secure Mode")
            .setDesc("Require password to unlock usage. Scheduler not supported.")
            .addToggle((toggle) => toggle
            .setTooltip("Toggle Secure Mode")
            .setValue(this.plugin.settings.secureMode)
            .onChange(async (value) => {
            if (value == this.plugin.settings.secureMode)
                return;
            let secureModeModal = new SecureModeModal(this.app, this.plugin, value);
            await secureModeModal.waitForResolve;
            if (secureModeModal.userPressedCrypt) {
                this.plugin.settings.secureMode = value;
                await this.plugin.saveSettings();
                this.display();
            }
            toggle.setValue(this.plugin.settings.secureMode);
            this.display();
        }));
    }
    addTweetTagSetting() {
        new obsidian.Setting(this.containerEl)
            .setName("Tweet Tag")
            .setDesc("Appended to your tweets to indicate that it has been posted.")
            .addText((text) => text
            .setPlaceholder("Tag to append")
            .setValue(this.plugin.settings.postTweetTag)
            .onChange(async (value) => {
            this.plugin.settings.postTweetTag = value;
            await this.plugin.saveSettings();
        }));
    }
    addAccessTokenSecretSetting() {
        new obsidian.Setting(this.containerEl)
            .setName("Access Token Secret")
            .setDesc("Twitter Access Token Secret.")
            .addText((text) => {
            this.setPasswordOnBlur(text.inputEl);
            text
                .setPlaceholder("Enter your Access Token Secret")
                .setValue(this.plugin.settings.accessTokenSecret)
                .onChange(async (value) => {
                this.plugin.settings.accessTokenSecret = value;
                await this.plugin.saveSettings();
                this.plugin.connectToTwitterWithPlainSettings();
                this.checkStatus();
            });
        });
    }
    addAccessTokenSetting() {
        new obsidian.Setting(this.containerEl)
            .setName("Access Token")
            .setDesc("Twitter Access Token.")
            .addText((text) => {
            this.setPasswordOnBlur(text.inputEl);
            text
                .setPlaceholder("Enter your Access Token")
                .setValue(this.plugin.settings.accessToken)
                .onChange(async (value) => {
                this.plugin.settings.accessToken = value;
                await this.plugin.saveSettings();
                this.plugin.connectToTwitterWithPlainSettings();
                this.checkStatus();
            });
        });
    }
    addApiSecretSetting() {
        new obsidian.Setting(this.containerEl)
            .setName("API Secret")
            .setDesc("Twitter API Secret.")
            .addText((text) => {
            this.setPasswordOnBlur(text.inputEl);
            text
                .setPlaceholder("Enter your API Secret")
                .setValue(this.plugin.settings.apiSecret)
                .onChange(async (value) => {
                this.plugin.settings.apiSecret = value;
                await this.plugin.saveSettings();
                this.plugin.connectToTwitterWithPlainSettings();
                this.checkStatus();
            });
        });
    }
    addApiKeySetting() {
        new obsidian.Setting(this.containerEl)
            .setName("API Key")
            .setDesc("Twitter API key.")
            .addText((text) => {
            this.setPasswordOnBlur(text.inputEl);
            text
                .setPlaceholder("Enter your API key")
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                this.plugin.settings.apiKey = value;
                await this.plugin.saveSettings();
                this.plugin.connectToTwitterWithPlainSettings();
                this.checkStatus();
            });
        });
    }
    addSchedulerSetting() {
        var _a;
        new obsidian.Setting(this.containerEl)
            .setName("Scheduling")
            .setDesc("Enable scheduling tweets. This will require some setup!")
            .addToggle(toggle => {
            var _a;
            return toggle.setTooltip('Toggle tweet scheduling')
                .setValue((_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.scheduling.enabled)
                .onChange(async (value) => {
                this.plugin.settings.scheduling.enabled = value;
                await this.plugin.saveSettings();
                this.display();
            });
        });
        new obsidian.Setting(this.containerEl)
            .setName('Scheduled tweets')
            .addButton(button => button
            .setButtonText("Open")
            .onClick(async () => {
            new ScheduledTweetsModal(this.app, this.plugin.scheduler).open();
        }));
        if ((_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.scheduling.enabled) {
            new obsidian.Setting(this.containerEl)
                .setName("Scheduler URL")
                .setDesc("Endpoint URL")
                .addText(text => {
                var _a;
                return text.setPlaceholder("Scheduler URL")
                    .setValue((_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.scheduling.url)
                    .onChange(async (value) => {
                    this.plugin.settings.scheduling.url = value;
                    await this.plugin.saveSettings();
                });
            });
            new obsidian.Setting(this.containerEl)
                .setName("Scheduler password")
                .setDesc("Password set for the scheduler")
                .addText(text => {
                var _a;
                this.setPasswordOnBlur(text.inputEl);
                text.setPlaceholder('Password')
                    .setValue((_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.scheduling.password)
                    .onChange(async (value) => {
                    this.plugin.settings.scheduling.password = value;
                    await this.plugin.saveSettings();
                });
            });
        }
    }
    setPasswordOnBlur(el) {
        el.addEventListener('focus', () => {
            el.type = "text";
        });
        el.addEventListener('blur', () => {
            el.type = "password";
        });
        el.type = "password";
    }
}

/* src/Modals/TweetsPostedModal/TweetsPostedModalContent.svelte generated by Svelte v3.37.0 */

function get_each_context(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[4] = list[i];
	return child_ctx;
}

// (10:4) {:else}
function create_else_block(ctx) {
	let h2;

	return {
		c() {
			h2 = element("h2");
			h2.textContent = "Your tweet is live! Check it out here:";
		},
		m(target, anchor) {
			insert(target, h2, anchor);
		},
		d(detaching) {
			if (detaching) detach(h2);
		}
	};
}

// (8:4) {#if multiplePosts}
function create_if_block(ctx) {
	let h2;

	return {
		c() {
			h2 = element("h2");
			h2.textContent = "Your tweets are live! Check them out here:";
		},
		m(target, anchor) {
			insert(target, h2, anchor);
		},
		d(detaching) {
			if (detaching) detach(h2);
		}
	};
}

// (14:4) {#each posts as post}
function create_each_block(ctx) {
	let a;
	let t0_value = /*post*/ ctx[4].data.text + "";
	let t0;
	let a_href_value;
	let t1;
	let br;

	return {
		c() {
			a = element("a");
			t0 = text(t0_value);
			t1 = space();
			br = element("br");
			attr(a, "href", a_href_value = "https://twitter.com/twitter/status/" + /*post*/ ctx[4].data.id);
		},
		m(target, anchor) {
			insert(target, a, anchor);
			append(a, t0);
			insert(target, t1, anchor);
			insert(target, br, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*posts*/ 1 && t0_value !== (t0_value = /*post*/ ctx[4].data.text + "")) set_data(t0, t0_value);

			if (dirty & /*posts*/ 1 && a_href_value !== (a_href_value = "https://twitter.com/twitter/status/" + /*post*/ ctx[4].data.id)) {
				attr(a, "href", a_href_value);
			}
		},
		d(detaching) {
			if (detaching) detach(a);
			if (detaching) detach(t1);
			if (detaching) detach(br);
		}
	};
}

function create_fragment$1(ctx) {
	let div;
	let t0;
	let t1;
	let button0;
	let t3;
	let button1;
	let mounted;
	let dispose;

	function select_block_type(ctx, dirty) {
		if (/*multiplePosts*/ ctx[3]) return create_if_block;
		return create_else_block;
	}

	let current_block_type = select_block_type(ctx);
	let if_block = current_block_type(ctx);
	let each_value = /*posts*/ ctx[0];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
	}

	return {
		c() {
			div = element("div");
			if_block.c();
			t0 = space();

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t1 = space();
			button0 = element("button");
			button0.textContent = "Great!";
			t3 = space();
			button1 = element("button");
			button1.textContent = "Delete";
			attr(button0, "class", "greenSuccessButton");
			set_style(button0, "float", "right");
			set_style(button0, "margin-top", "1rem");
			attr(button1, "class", "redWarningButton");
			set_style(button1, "float", "right");
			set_style(button1, "margin", "1rem");
		},
		m(target, anchor) {
			insert(target, div, anchor);
			if_block.m(div, null);
			append(div, t0);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(div, null);
			}

			append(div, t1);
			append(div, button0);
			append(div, t3);
			append(div, button1);

			if (!mounted) {
				dispose = [
					listen(button0, "click", function () {
						if (is_function(/*onAccept*/ ctx[2]())) /*onAccept*/ ctx[2]().apply(this, arguments);
					}),
					listen(button1, "click", function () {
						if (is_function(/*onDelete*/ ctx[1]())) /*onDelete*/ ctx[1]().apply(this, arguments);
					})
				];

				mounted = true;
			}
		},
		p(new_ctx, [dirty]) {
			ctx = new_ctx;

			if (dirty & /*posts*/ 1) {
				each_value = /*posts*/ ctx[0];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(div, t1);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value.length;
			}
		},
		i: noop$2,
		o: noop$2,
		d(detaching) {
			if (detaching) detach(div);
			if_block.d();
			destroy_each(each_blocks, detaching);
			mounted = false;
			run_all(dispose);
		}
	};
}

function instance$1($$self, $$props, $$invalidate) {
	let { posts } = $$props;
	let { onDelete } = $$props;
	let { onAccept } = $$props;
	let multiplePosts = posts.length > 1;

	$$self.$$set = $$props => {
		if ("posts" in $$props) $$invalidate(0, posts = $$props.posts);
		if ("onDelete" in $$props) $$invalidate(1, onDelete = $$props.onDelete);
		if ("onAccept" in $$props) $$invalidate(2, onAccept = $$props.onAccept);
	};

	return [posts, onDelete, onAccept, multiplePosts];
}

class TweetsPostedModalContent extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$1, create_fragment$1, safe_not_equal, { posts: 0, onDelete: 1, onAccept: 2 });
	}
}

class TweetsPostedModal extends obsidian.Modal {
    constructor(app, post, twitterHandler) {
        super(app);
        this.userDeletedTweets = false;
        this.posts = post;
        this.twitterHandler = twitterHandler;
        this.waitForClose = new Promise((resolve) => (this.resolvePromise = resolve));
        this.modalContent = new TweetsPostedModalContent({
            target: this.contentEl,
            props: {
                posts: this.posts,
                onDelete: this.deleteTweets(),
                onAccept: () => this.close(),
            },
        });
        this.open();
    }
    deleteTweets() {
        return async () => {
            let tweetsToDelete = [];
            for (const tweet of this.posts) {
                tweetsToDelete.push({
                    id: tweet.data.id,
                    text: tweet.data.text,
                });
            }
            let didDeleteTweets = await this.twitterHandler.deleteTweets(tweetsToDelete);
            if (didDeleteTweets) {
                this.userDeletedTweets = true;
                this.close();
                new obsidian.Notice(`${this.posts.length} tweet${this.posts.length > 1 ? "s" : ""} deleted.`);
            }
            else
                new obsidian.Notice(`Could not delete tweet(s)`);
        };
    }
    onClose() {
        super.onClose();
        this.modalContent.$destroy();
        this.resolvePromise();
    }
}

class TweetErrorModal extends obsidian.Modal {
    constructor(app, errorMessage) {
        super(app);
        this.errorMessage = errorMessage;
    }
    onOpen() {
        let { contentEl } = this;
        contentEl.setText(`NoteTweet: ${this.errorMessage}`);
    }
    onClose() {
        let { contentEl } = this;
        contentEl.empty();
    }
}

/* src/Modals/SecureModeGetPasswordModal/SecureModeGetPasswordModalContent.svelte generated by Svelte v3.37.0 */

function create_fragment(ctx) {
	let div;
	let h2;
	let t1;
	let p;
	let t3;
	let label;
	let input;
	let t4;
	let button;
	let mounted;
	let dispose;

	return {
		c() {
			div = element("div");
			h2 = element("h2");
			h2.textContent = "Secure Mode";
			t1 = space();
			p = element("p");
			p.textContent = "Please enter your password to continue.";
			t3 = space();
			label = element("label");
			input = element("input");
			t4 = space();
			button = element("button");
			button.textContent = "Submit";
			attr(input, "type", "password");
			set_style(button, "margin-left", "1rem");
		},
		m(target, anchor) {
			insert(target, div, anchor);
			append(div, h2);
			append(div, t1);
			append(div, p);
			append(div, t3);
			append(div, label);
			append(label, input);
			/*input_binding*/ ctx[2](input);
			append(div, t4);
			append(div, button);

			if (!mounted) {
				dispose = listen(button, "click", /*click_handler*/ ctx[3]);
				mounted = true;
			}
		},
		p: noop$2,
		i: noop$2,
		o: noop$2,
		d(detaching) {
			if (detaching) detach(div);
			/*input_binding*/ ctx[2](null);
			mounted = false;
			dispose();
		}
	};
}

function instance($$self, $$props, $$invalidate) {
	let passwordInput;
	let { onSubmit } = $$props;

	function input_binding($$value) {
		binding_callbacks[$$value ? "unshift" : "push"](() => {
			passwordInput = $$value;
			$$invalidate(1, passwordInput);
		});
	}

	const click_handler = () => onSubmit(passwordInput.value);

	$$self.$$set = $$props => {
		if ("onSubmit" in $$props) $$invalidate(0, onSubmit = $$props.onSubmit);
	};

	return [onSubmit, passwordInput, input_binding, click_handler];
}

class SecureModeGetPasswordModalContent extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance, create_fragment, safe_not_equal, { onSubmit: 0 });
	}
}

class SecureModeGetPasswordModal extends obsidian.Modal {
    constructor(app, plugin) {
        super(app);
        this._plugin = plugin;
        this.waitForClose = new Promise((resolve) => (this.resolvePromise = resolve));
        this.modalContent = new SecureModeGetPasswordModalContent({
            target: this.contentEl,
            props: {
                onSubmit: (value) => this.onSubmit(value),
            },
        });
        this.open();
    }
    onClose() {
        super.onClose();
        this.modalContent.$destroy();
        this.resolvePromise();
    }
    onSubmit(value) {
        if (value === "")
            return;
        try {
            this.secureModeLogin(value);
        }
        catch (e) {
            new obsidian.Notice("Wrong password.");
        }
        if (this._plugin.twitterHandler.isConnectedToTwitter) {
            new obsidian.Notice("Successfully authenticated with Twitter!");
            this.close();
        }
    }
    secureModeLogin(password) {
        this._plugin.twitterHandler.connectToTwitter(SecureModeCrypt.decryptString(this._plugin.settings.apiKey, password), SecureModeCrypt.decryptString(this._plugin.settings.apiSecret, password), SecureModeCrypt.decryptString(this._plugin.settings.accessToken, password), SecureModeCrypt.decryptString(this._plugin.settings.accessTokenSecret, password));
    }
}

var ErrorLevel;
(function (ErrorLevel) {
    ErrorLevel["Error"] = "ERROR";
    ErrorLevel["Warning"] = "WARNING";
    ErrorLevel["Log"] = "LOG";
})(ErrorLevel || (ErrorLevel = {}));

class NoteTweetLogger {
    formatOutputString(error) {
        return `NoteTweet: (${error.level}) ${error.message}`;
    }
    getNoteTweetError(message, level) {
        return { message, level, time: Date.now() };
    }
}

class ConsoleErrorLogger extends NoteTweetLogger {
    constructor() {
        super(...arguments);
        this.ErrorLog = [];
    }
    logError(errorMsg) {
        const error = this.getNoteTweetError(errorMsg, ErrorLevel.Error);
        this.addMessageToErrorLog(error);
        console.error(this.formatOutputString(error));
    }
    logWarning(warningMsg) {
        const warning = this.getNoteTweetError(warningMsg, ErrorLevel.Warning);
        this.addMessageToErrorLog(warning);
        console.warn(this.formatOutputString(warning));
    }
    logMessage(logMsg) {
        const log = this.getNoteTweetError(logMsg, ErrorLevel.Log);
        this.addMessageToErrorLog(log);
        console.log(this.formatOutputString(log));
    }
    addMessageToErrorLog(error) {
        this.ErrorLog.push(error);
    }
}

class GuiLogger extends NoteTweetLogger {
    constructor(plugin) {
        super();
        this.plugin = plugin;
    }
    logError(msg) {
        new TweetErrorModal(this.plugin.app, msg).open();
    }
    logWarning(msg) {
        new obsidian.Notice(msg);
    }
    logMessage(msg) { }
}

var dist = createCommonjsModule(function (module, exports) {
/// <reference lib="es2018"/>
/// <reference lib="dom"/>
/// <reference types="node"/>
Object.defineProperty(exports, "__esModule", { value: true });
const typedArrayTypeNames = [
    'Int8Array',
    'Uint8Array',
    'Uint8ClampedArray',
    'Int16Array',
    'Uint16Array',
    'Int32Array',
    'Uint32Array',
    'Float32Array',
    'Float64Array',
    'BigInt64Array',
    'BigUint64Array'
];
function isTypedArrayName(name) {
    return typedArrayTypeNames.includes(name);
}
const objectTypeNames = [
    'Function',
    'Generator',
    'AsyncGenerator',
    'GeneratorFunction',
    'AsyncGeneratorFunction',
    'AsyncFunction',
    'Observable',
    'Array',
    'Buffer',
    'Blob',
    'Object',
    'RegExp',
    'Date',
    'Error',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'ArrayBuffer',
    'SharedArrayBuffer',
    'DataView',
    'Promise',
    'URL',
    'FormData',
    'URLSearchParams',
    'HTMLElement',
    ...typedArrayTypeNames
];
function isObjectTypeName(name) {
    return objectTypeNames.includes(name);
}
const primitiveTypeNames = [
    'null',
    'undefined',
    'string',
    'number',
    'bigint',
    'boolean',
    'symbol'
];
function isPrimitiveTypeName(name) {
    return primitiveTypeNames.includes(name);
}
// eslint-disable-next-line @typescript-eslint/ban-types
function isOfType(type) {
    return (value) => typeof value === type;
}
const { toString } = Object.prototype;
const getObjectType = (value) => {
    const objectTypeName = toString.call(value).slice(8, -1);
    if (/HTML\w+Element/.test(objectTypeName) && is.domElement(value)) {
        return 'HTMLElement';
    }
    if (isObjectTypeName(objectTypeName)) {
        return objectTypeName;
    }
    return undefined;
};
const isObjectOfType = (type) => (value) => getObjectType(value) === type;
function is(value) {
    if (value === null) {
        return 'null';
    }
    switch (typeof value) {
        case 'undefined':
            return 'undefined';
        case 'string':
            return 'string';
        case 'number':
            return 'number';
        case 'boolean':
            return 'boolean';
        case 'function':
            return 'Function';
        case 'bigint':
            return 'bigint';
        case 'symbol':
            return 'symbol';
    }
    if (is.observable(value)) {
        return 'Observable';
    }
    if (is.array(value)) {
        return 'Array';
    }
    if (is.buffer(value)) {
        return 'Buffer';
    }
    const tagType = getObjectType(value);
    if (tagType) {
        return tagType;
    }
    if (value instanceof String || value instanceof Boolean || value instanceof Number) {
        throw new TypeError('Please don\'t use object wrappers for primitive types');
    }
    return 'Object';
}
is.undefined = isOfType('undefined');
is.string = isOfType('string');
const isNumberType = isOfType('number');
is.number = (value) => isNumberType(value) && !is.nan(value);
is.bigint = isOfType('bigint');
// eslint-disable-next-line @typescript-eslint/ban-types
is.function_ = isOfType('function');
is.null_ = (value) => value === null;
is.class_ = (value) => is.function_(value) && value.toString().startsWith('class ');
is.boolean = (value) => value === true || value === false;
is.symbol = isOfType('symbol');
is.numericString = (value) => is.string(value) && !is.emptyStringOrWhitespace(value) && !Number.isNaN(Number(value));
is.array = (value, assertion) => {
    if (!Array.isArray(value)) {
        return false;
    }
    if (!is.function_(assertion)) {
        return true;
    }
    return value.every(assertion);
};
is.buffer = (value) => { var _a, _b, _c, _d; return (_d = (_c = (_b = (_a = value) === null || _a === void 0 ? void 0 : _a.constructor) === null || _b === void 0 ? void 0 : _b.isBuffer) === null || _c === void 0 ? void 0 : _c.call(_b, value)) !== null && _d !== void 0 ? _d : false; };
is.blob = (value) => isObjectOfType('Blob')(value);
is.nullOrUndefined = (value) => is.null_(value) || is.undefined(value);
is.object = (value) => !is.null_(value) && (typeof value === 'object' || is.function_(value));
is.iterable = (value) => { var _a; return is.function_((_a = value) === null || _a === void 0 ? void 0 : _a[Symbol.iterator]); };
is.asyncIterable = (value) => { var _a; return is.function_((_a = value) === null || _a === void 0 ? void 0 : _a[Symbol.asyncIterator]); };
is.generator = (value) => { var _a, _b; return is.iterable(value) && is.function_((_a = value) === null || _a === void 0 ? void 0 : _a.next) && is.function_((_b = value) === null || _b === void 0 ? void 0 : _b.throw); };
is.asyncGenerator = (value) => is.asyncIterable(value) && is.function_(value.next) && is.function_(value.throw);
is.nativePromise = (value) => isObjectOfType('Promise')(value);
const hasPromiseAPI = (value) => {
    var _a, _b;
    return is.function_((_a = value) === null || _a === void 0 ? void 0 : _a.then) &&
        is.function_((_b = value) === null || _b === void 0 ? void 0 : _b.catch);
};
is.promise = (value) => is.nativePromise(value) || hasPromiseAPI(value);
is.generatorFunction = isObjectOfType('GeneratorFunction');
is.asyncGeneratorFunction = (value) => getObjectType(value) === 'AsyncGeneratorFunction';
is.asyncFunction = (value) => getObjectType(value) === 'AsyncFunction';
// eslint-disable-next-line no-prototype-builtins, @typescript-eslint/ban-types
is.boundFunction = (value) => is.function_(value) && !value.hasOwnProperty('prototype');
is.regExp = isObjectOfType('RegExp');
is.date = isObjectOfType('Date');
is.error = isObjectOfType('Error');
is.map = (value) => isObjectOfType('Map')(value);
is.set = (value) => isObjectOfType('Set')(value);
is.weakMap = (value) => isObjectOfType('WeakMap')(value);
is.weakSet = (value) => isObjectOfType('WeakSet')(value);
is.int8Array = isObjectOfType('Int8Array');
is.uint8Array = isObjectOfType('Uint8Array');
is.uint8ClampedArray = isObjectOfType('Uint8ClampedArray');
is.int16Array = isObjectOfType('Int16Array');
is.uint16Array = isObjectOfType('Uint16Array');
is.int32Array = isObjectOfType('Int32Array');
is.uint32Array = isObjectOfType('Uint32Array');
is.float32Array = isObjectOfType('Float32Array');
is.float64Array = isObjectOfType('Float64Array');
is.bigInt64Array = isObjectOfType('BigInt64Array');
is.bigUint64Array = isObjectOfType('BigUint64Array');
is.arrayBuffer = isObjectOfType('ArrayBuffer');
is.sharedArrayBuffer = isObjectOfType('SharedArrayBuffer');
is.dataView = isObjectOfType('DataView');
is.enumCase = (value, targetEnum) => Object.values(targetEnum).includes(value);
is.directInstanceOf = (instance, class_) => Object.getPrototypeOf(instance) === class_.prototype;
is.urlInstance = (value) => isObjectOfType('URL')(value);
is.urlString = (value) => {
    if (!is.string(value)) {
        return false;
    }
    try {
        new URL(value); // eslint-disable-line no-new
        return true;
    }
    catch (_a) {
        return false;
    }
};
// Example: `is.truthy = (value: unknown): value is (not false | not 0 | not '' | not undefined | not null) => Boolean(value);`
is.truthy = (value) => Boolean(value);
// Example: `is.falsy = (value: unknown): value is (not true | 0 | '' | undefined | null) => Boolean(value);`
is.falsy = (value) => !value;
is.nan = (value) => Number.isNaN(value);
is.primitive = (value) => is.null_(value) || isPrimitiveTypeName(typeof value);
is.integer = (value) => Number.isInteger(value);
is.safeInteger = (value) => Number.isSafeInteger(value);
is.plainObject = (value) => {
    // From: https://github.com/sindresorhus/is-plain-obj/blob/main/index.js
    if (toString.call(value) !== '[object Object]') {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.getPrototypeOf({});
};
is.typedArray = (value) => isTypedArrayName(getObjectType(value));
const isValidLength = (value) => is.safeInteger(value) && value >= 0;
is.arrayLike = (value) => !is.nullOrUndefined(value) && !is.function_(value) && isValidLength(value.length);
is.inRange = (value, range) => {
    if (is.number(range)) {
        return value >= Math.min(0, range) && value <= Math.max(range, 0);
    }
    if (is.array(range) && range.length === 2) {
        return value >= Math.min(...range) && value <= Math.max(...range);
    }
    throw new TypeError(`Invalid range: ${JSON.stringify(range)}`);
};
const NODE_TYPE_ELEMENT = 1;
const DOM_PROPERTIES_TO_CHECK = [
    'innerHTML',
    'ownerDocument',
    'style',
    'attributes',
    'nodeValue'
];
is.domElement = (value) => {
    return is.object(value) &&
        value.nodeType === NODE_TYPE_ELEMENT &&
        is.string(value.nodeName) &&
        !is.plainObject(value) &&
        DOM_PROPERTIES_TO_CHECK.every(property => property in value);
};
is.observable = (value) => {
    var _a, _b, _c, _d;
    if (!value) {
        return false;
    }
    // eslint-disable-next-line no-use-extend-native/no-use-extend-native
    if (value === ((_b = (_a = value)[Symbol.observable]) === null || _b === void 0 ? void 0 : _b.call(_a))) {
        return true;
    }
    if (value === ((_d = (_c = value)['@@observable']) === null || _d === void 0 ? void 0 : _d.call(_c))) {
        return true;
    }
    return false;
};
is.nodeStream = (value) => is.object(value) && is.function_(value.pipe) && !is.observable(value);
is.infinite = (value) => value === Infinity || value === -Infinity;
const isAbsoluteMod2 = (remainder) => (value) => is.integer(value) && Math.abs(value % 2) === remainder;
is.evenInteger = isAbsoluteMod2(0);
is.oddInteger = isAbsoluteMod2(1);
is.emptyArray = (value) => is.array(value) && value.length === 0;
is.nonEmptyArray = (value) => is.array(value) && value.length > 0;
is.emptyString = (value) => is.string(value) && value.length === 0;
const isWhiteSpaceString = (value) => is.string(value) && !/\S/.test(value);
is.emptyStringOrWhitespace = (value) => is.emptyString(value) || isWhiteSpaceString(value);
// TODO: Use `not ''` when the `not` operator is available.
is.nonEmptyString = (value) => is.string(value) && value.length > 0;
// TODO: Use `not ''` when the `not` operator is available.
is.nonEmptyStringAndNotWhitespace = (value) => is.string(value) && !is.emptyStringOrWhitespace(value);
is.emptyObject = (value) => is.object(value) && !is.map(value) && !is.set(value) && Object.keys(value).length === 0;
// TODO: Use `not` operator here to remove `Map` and `Set` from type guard:
// - https://github.com/Microsoft/TypeScript/pull/29317
is.nonEmptyObject = (value) => is.object(value) && !is.map(value) && !is.set(value) && Object.keys(value).length > 0;
is.emptySet = (value) => is.set(value) && value.size === 0;
is.nonEmptySet = (value) => is.set(value) && value.size > 0;
is.emptyMap = (value) => is.map(value) && value.size === 0;
is.nonEmptyMap = (value) => is.map(value) && value.size > 0;
// `PropertyKey` is any value that can be used as an object key (string, number, or symbol)
is.propertyKey = (value) => is.any([is.string, is.number, is.symbol], value);
is.formData = (value) => isObjectOfType('FormData')(value);
is.urlSearchParams = (value) => isObjectOfType('URLSearchParams')(value);
const predicateOnArray = (method, predicate, values) => {
    if (!is.function_(predicate)) {
        throw new TypeError(`Invalid predicate: ${JSON.stringify(predicate)}`);
    }
    if (values.length === 0) {
        throw new TypeError('Invalid number of values');
    }
    return method.call(values, predicate);
};
is.any = (predicate, ...values) => {
    const predicates = is.array(predicate) ? predicate : [predicate];
    return predicates.some(singlePredicate => predicateOnArray(Array.prototype.some, singlePredicate, values));
};
is.all = (predicate, ...values) => predicateOnArray(Array.prototype.every, predicate, values);
const assertType = (condition, description, value, options = {}) => {
    if (!condition) {
        const { multipleValues } = options;
        const valuesMessage = multipleValues ?
            `received values of types ${[
                ...new Set(value.map(singleValue => `\`${is(singleValue)}\``))
            ].join(', ')}` :
            `received value of type \`${is(value)}\``;
        throw new TypeError(`Expected value which is \`${description}\`, ${valuesMessage}.`);
    }
};
exports.assert = {
    // Unknowns.
    undefined: (value) => assertType(is.undefined(value), 'undefined', value),
    string: (value) => assertType(is.string(value), 'string', value),
    number: (value) => assertType(is.number(value), 'number', value),
    bigint: (value) => assertType(is.bigint(value), 'bigint', value),
    // eslint-disable-next-line @typescript-eslint/ban-types
    function_: (value) => assertType(is.function_(value), 'Function', value),
    null_: (value) => assertType(is.null_(value), 'null', value),
    class_: (value) => assertType(is.class_(value), "Class" /* class_ */, value),
    boolean: (value) => assertType(is.boolean(value), 'boolean', value),
    symbol: (value) => assertType(is.symbol(value), 'symbol', value),
    numericString: (value) => assertType(is.numericString(value), "string with a number" /* numericString */, value),
    array: (value, assertion) => {
        const assert = assertType;
        assert(is.array(value), 'Array', value);
        if (assertion) {
            value.forEach(assertion);
        }
    },
    buffer: (value) => assertType(is.buffer(value), 'Buffer', value),
    blob: (value) => assertType(is.blob(value), 'Blob', value),
    nullOrUndefined: (value) => assertType(is.nullOrUndefined(value), "null or undefined" /* nullOrUndefined */, value),
    object: (value) => assertType(is.object(value), 'Object', value),
    iterable: (value) => assertType(is.iterable(value), "Iterable" /* iterable */, value),
    asyncIterable: (value) => assertType(is.asyncIterable(value), "AsyncIterable" /* asyncIterable */, value),
    generator: (value) => assertType(is.generator(value), 'Generator', value),
    asyncGenerator: (value) => assertType(is.asyncGenerator(value), 'AsyncGenerator', value),
    nativePromise: (value) => assertType(is.nativePromise(value), "native Promise" /* nativePromise */, value),
    promise: (value) => assertType(is.promise(value), 'Promise', value),
    generatorFunction: (value) => assertType(is.generatorFunction(value), 'GeneratorFunction', value),
    asyncGeneratorFunction: (value) => assertType(is.asyncGeneratorFunction(value), 'AsyncGeneratorFunction', value),
    // eslint-disable-next-line @typescript-eslint/ban-types
    asyncFunction: (value) => assertType(is.asyncFunction(value), 'AsyncFunction', value),
    // eslint-disable-next-line @typescript-eslint/ban-types
    boundFunction: (value) => assertType(is.boundFunction(value), 'Function', value),
    regExp: (value) => assertType(is.regExp(value), 'RegExp', value),
    date: (value) => assertType(is.date(value), 'Date', value),
    error: (value) => assertType(is.error(value), 'Error', value),
    map: (value) => assertType(is.map(value), 'Map', value),
    set: (value) => assertType(is.set(value), 'Set', value),
    weakMap: (value) => assertType(is.weakMap(value), 'WeakMap', value),
    weakSet: (value) => assertType(is.weakSet(value), 'WeakSet', value),
    int8Array: (value) => assertType(is.int8Array(value), 'Int8Array', value),
    uint8Array: (value) => assertType(is.uint8Array(value), 'Uint8Array', value),
    uint8ClampedArray: (value) => assertType(is.uint8ClampedArray(value), 'Uint8ClampedArray', value),
    int16Array: (value) => assertType(is.int16Array(value), 'Int16Array', value),
    uint16Array: (value) => assertType(is.uint16Array(value), 'Uint16Array', value),
    int32Array: (value) => assertType(is.int32Array(value), 'Int32Array', value),
    uint32Array: (value) => assertType(is.uint32Array(value), 'Uint32Array', value),
    float32Array: (value) => assertType(is.float32Array(value), 'Float32Array', value),
    float64Array: (value) => assertType(is.float64Array(value), 'Float64Array', value),
    bigInt64Array: (value) => assertType(is.bigInt64Array(value), 'BigInt64Array', value),
    bigUint64Array: (value) => assertType(is.bigUint64Array(value), 'BigUint64Array', value),
    arrayBuffer: (value) => assertType(is.arrayBuffer(value), 'ArrayBuffer', value),
    sharedArrayBuffer: (value) => assertType(is.sharedArrayBuffer(value), 'SharedArrayBuffer', value),
    dataView: (value) => assertType(is.dataView(value), 'DataView', value),
    enumCase: (value, targetEnum) => assertType(is.enumCase(value, targetEnum), 'EnumCase', value),
    urlInstance: (value) => assertType(is.urlInstance(value), 'URL', value),
    urlString: (value) => assertType(is.urlString(value), "string with a URL" /* urlString */, value),
    truthy: (value) => assertType(is.truthy(value), "truthy" /* truthy */, value),
    falsy: (value) => assertType(is.falsy(value), "falsy" /* falsy */, value),
    nan: (value) => assertType(is.nan(value), "NaN" /* nan */, value),
    primitive: (value) => assertType(is.primitive(value), "primitive" /* primitive */, value),
    integer: (value) => assertType(is.integer(value), "integer" /* integer */, value),
    safeInteger: (value) => assertType(is.safeInteger(value), "integer" /* safeInteger */, value),
    plainObject: (value) => assertType(is.plainObject(value), "plain object" /* plainObject */, value),
    typedArray: (value) => assertType(is.typedArray(value), "TypedArray" /* typedArray */, value),
    arrayLike: (value) => assertType(is.arrayLike(value), "array-like" /* arrayLike */, value),
    domElement: (value) => assertType(is.domElement(value), "HTMLElement" /* domElement */, value),
    observable: (value) => assertType(is.observable(value), 'Observable', value),
    nodeStream: (value) => assertType(is.nodeStream(value), "Node.js Stream" /* nodeStream */, value),
    infinite: (value) => assertType(is.infinite(value), "infinite number" /* infinite */, value),
    emptyArray: (value) => assertType(is.emptyArray(value), "empty array" /* emptyArray */, value),
    nonEmptyArray: (value) => assertType(is.nonEmptyArray(value), "non-empty array" /* nonEmptyArray */, value),
    emptyString: (value) => assertType(is.emptyString(value), "empty string" /* emptyString */, value),
    emptyStringOrWhitespace: (value) => assertType(is.emptyStringOrWhitespace(value), "empty string or whitespace" /* emptyStringOrWhitespace */, value),
    nonEmptyString: (value) => assertType(is.nonEmptyString(value), "non-empty string" /* nonEmptyString */, value),
    nonEmptyStringAndNotWhitespace: (value) => assertType(is.nonEmptyStringAndNotWhitespace(value), "non-empty string and not whitespace" /* nonEmptyStringAndNotWhitespace */, value),
    emptyObject: (value) => assertType(is.emptyObject(value), "empty object" /* emptyObject */, value),
    nonEmptyObject: (value) => assertType(is.nonEmptyObject(value), "non-empty object" /* nonEmptyObject */, value),
    emptySet: (value) => assertType(is.emptySet(value), "empty set" /* emptySet */, value),
    nonEmptySet: (value) => assertType(is.nonEmptySet(value), "non-empty set" /* nonEmptySet */, value),
    emptyMap: (value) => assertType(is.emptyMap(value), "empty map" /* emptyMap */, value),
    nonEmptyMap: (value) => assertType(is.nonEmptyMap(value), "non-empty map" /* nonEmptyMap */, value),
    propertyKey: (value) => assertType(is.propertyKey(value), 'PropertyKey', value),
    formData: (value) => assertType(is.formData(value), 'FormData', value),
    urlSearchParams: (value) => assertType(is.urlSearchParams(value), 'URLSearchParams', value),
    // Numbers.
    evenInteger: (value) => assertType(is.evenInteger(value), "even integer" /* evenInteger */, value),
    oddInteger: (value) => assertType(is.oddInteger(value), "odd integer" /* oddInteger */, value),
    // Two arguments.
    directInstanceOf: (instance, class_) => assertType(is.directInstanceOf(instance, class_), "T" /* directInstanceOf */, instance),
    inRange: (value, range) => assertType(is.inRange(value, range), "in range" /* inRange */, value),
    // Variadic functions.
    any: (predicate, ...values) => {
        return assertType(is.any(predicate, ...values), "predicate returns truthy for any value" /* any */, values, { multipleValues: true });
    },
    all: (predicate, ...values) => assertType(is.all(predicate, ...values), "predicate returns truthy for all values" /* all */, values, { multipleValues: true })
};
// Some few keywords are reserved, but we'll populate them for Node.js users
// See https://github.com/Microsoft/TypeScript/issues/2536
Object.defineProperties(is, {
    class: {
        value: is.class_
    },
    function: {
        value: is.function_
    },
    null: {
        value: is.null_
    }
});
Object.defineProperties(exports.assert, {
    class: {
        value: exports.assert.class_
    },
    function: {
        value: exports.assert.function_
    },
    null: {
        value: exports.assert.null_
    }
});
exports.default = is;
// For CommonJS default export support
module.exports = is;
module.exports.default = is;
module.exports.assert = exports.assert;
});

class CancelError extends Error {
	constructor(reason) {
		super(reason || 'Promise was canceled');
		this.name = 'CancelError';
	}

	get isCanceled() {
		return true;
	}
}

class PCancelable {
	static fn(userFn) {
		return (...arguments_) => {
			return new PCancelable((resolve, reject, onCancel) => {
				arguments_.push(onCancel);
				// eslint-disable-next-line promise/prefer-await-to-then
				userFn(...arguments_).then(resolve, reject);
			});
		};
	}

	constructor(executor) {
		this._cancelHandlers = [];
		this._isPending = true;
		this._isCanceled = false;
		this._rejectOnCancel = true;

		this._promise = new Promise((resolve, reject) => {
			this._reject = reject;

			const onResolve = value => {
				if (!this._isCanceled || !onCancel.shouldReject) {
					this._isPending = false;
					resolve(value);
				}
			};

			const onReject = error => {
				this._isPending = false;
				reject(error);
			};

			const onCancel = handler => {
				if (!this._isPending) {
					throw new Error('The `onCancel` handler was attached after the promise settled.');
				}

				this._cancelHandlers.push(handler);
			};

			Object.defineProperties(onCancel, {
				shouldReject: {
					get: () => this._rejectOnCancel,
					set: boolean => {
						this._rejectOnCancel = boolean;
					}
				}
			});

			return executor(onResolve, onReject, onCancel);
		});
	}

	then(onFulfilled, onRejected) {
		// eslint-disable-next-line promise/prefer-await-to-then
		return this._promise.then(onFulfilled, onRejected);
	}

	catch(onRejected) {
		return this._promise.catch(onRejected);
	}

	finally(onFinally) {
		return this._promise.finally(onFinally);
	}

	cancel(reason) {
		if (!this._isPending || this._isCanceled) {
			return;
		}

		this._isCanceled = true;

		if (this._cancelHandlers.length > 0) {
			try {
				for (const handler of this._cancelHandlers) {
					handler();
				}
			} catch (error) {
				this._reject(error);
				return;
			}
		}

		if (this._rejectOnCancel) {
			this._reject(new CancelError(reason));
		}
	}

	get isCanceled() {
		return this._isCanceled;
	}
}

Object.setPrototypeOf(PCancelable.prototype, Promise.prototype);

var pCancelable = PCancelable;
var CancelError_1 = CancelError;
pCancelable.CancelError = CancelError_1;

var source$4 = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });
function isTLSSocket(socket) {
    return socket.encrypted;
}
const deferToConnect = (socket, fn) => {
    let listeners;
    if (typeof fn === 'function') {
        const connect = fn;
        listeners = { connect };
    }
    else {
        listeners = fn;
    }
    const hasConnectListener = typeof listeners.connect === 'function';
    const hasSecureConnectListener = typeof listeners.secureConnect === 'function';
    const hasCloseListener = typeof listeners.close === 'function';
    const onConnect = () => {
        if (hasConnectListener) {
            listeners.connect();
        }
        if (isTLSSocket(socket) && hasSecureConnectListener) {
            if (socket.authorized) {
                listeners.secureConnect();
            }
            else if (!socket.authorizationError) {
                socket.once('secureConnect', listeners.secureConnect);
            }
        }
        if (hasCloseListener) {
            socket.once('close', listeners.close);
        }
    };
    if (socket.writable && !socket.connecting) {
        onConnect();
    }
    else if (socket.connecting) {
        socket.once('connect', onConnect);
    }
    else if (socket.destroyed && hasCloseListener) {
        listeners.close(socket._hadError);
    }
};
exports.default = deferToConnect;
// For CommonJS default export support
module.exports = deferToConnect;
module.exports.default = deferToConnect;
});

var source$3 = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });


const nodejsMajorVersion = Number(process.versions.node.split('.')[0]);
const timer = (request) => {
    if (request.timings) {
        return request.timings;
    }
    const timings = {
        start: Date.now(),
        socket: undefined,
        lookup: undefined,
        connect: undefined,
        secureConnect: undefined,
        upload: undefined,
        response: undefined,
        end: undefined,
        error: undefined,
        abort: undefined,
        phases: {
            wait: undefined,
            dns: undefined,
            tcp: undefined,
            tls: undefined,
            request: undefined,
            firstByte: undefined,
            download: undefined,
            total: undefined
        }
    };
    request.timings = timings;
    const handleError = (origin) => {
        const emit = origin.emit.bind(origin);
        origin.emit = (event, ...args) => {
            // Catches the `error` event
            if (event === 'error') {
                timings.error = Date.now();
                timings.phases.total = timings.error - timings.start;
                origin.emit = emit;
            }
            // Saves the original behavior
            return emit(event, ...args);
        };
    };
    handleError(request);
    const onAbort = () => {
        timings.abort = Date.now();
        // Let the `end` response event be responsible for setting the total phase,
        // unless the Node.js major version is >= 13.
        if (!timings.response || nodejsMajorVersion >= 13) {
            timings.phases.total = Date.now() - timings.start;
        }
    };
    request.prependOnceListener('abort', onAbort);
    const onSocket = (socket) => {
        timings.socket = Date.now();
        timings.phases.wait = timings.socket - timings.start;
        if (util_1__default["default"].types.isProxy(socket)) {
            return;
        }
        const lookupListener = () => {
            timings.lookup = Date.now();
            timings.phases.dns = timings.lookup - timings.socket;
        };
        socket.prependOnceListener('lookup', lookupListener);
        source$4.default(socket, {
            connect: () => {
                timings.connect = Date.now();
                if (timings.lookup === undefined) {
                    socket.removeListener('lookup', lookupListener);
                    timings.lookup = timings.connect;
                    timings.phases.dns = timings.lookup - timings.socket;
                }
                timings.phases.tcp = timings.connect - timings.lookup;
                // This callback is called before flushing any data,
                // so we don't need to set `timings.phases.request` here.
            },
            secureConnect: () => {
                timings.secureConnect = Date.now();
                timings.phases.tls = timings.secureConnect - timings.connect;
            }
        });
    };
    if (request.socket) {
        onSocket(request.socket);
    }
    else {
        request.prependOnceListener('socket', onSocket);
    }
    const onUpload = () => {
        var _a;
        timings.upload = Date.now();
        timings.phases.request = timings.upload - ((_a = timings.secureConnect) !== null && _a !== void 0 ? _a : timings.connect);
    };
    const writableFinished = () => {
        if (typeof request.writableFinished === 'boolean') {
            return request.writableFinished;
        }
        // Node.js doesn't have `request.writableFinished` property
        return request.finished && request.outputSize === 0 && (!request.socket || request.socket.writableLength === 0);
    };
    if (writableFinished()) {
        onUpload();
    }
    else {
        request.prependOnceListener('finish', onUpload);
    }
    request.prependOnceListener('response', (response) => {
        timings.response = Date.now();
        timings.phases.firstByte = timings.response - timings.upload;
        response.timings = timings;
        handleError(response);
        response.prependOnceListener('end', () => {
            timings.end = Date.now();
            timings.phases.download = timings.end - timings.response;
            timings.phases.total = timings.end - timings.start;
        });
        response.prependOnceListener('aborted', onAbort);
    });
    return timings;
};
exports.default = timer;
// For CommonJS default export support
module.exports = timer;
module.exports.default = timer;
});

const {
	V4MAPPED,
	ADDRCONFIG,
	ALL,
	promises: {
		Resolver: AsyncResolver
	},
	lookup: dnsLookup
} = require$$0__default$1["default"];
const {promisify} = util_1__default["default"];


const kCacheableLookupCreateConnection = Symbol('cacheableLookupCreateConnection');
const kCacheableLookupInstance = Symbol('cacheableLookupInstance');
const kExpires = Symbol('expires');

const supportsALL = typeof ALL === 'number';

const verifyAgent = agent => {
	if (!(agent && typeof agent.createConnection === 'function')) {
		throw new Error('Expected an Agent instance as the first argument');
	}
};

const map4to6 = entries => {
	for (const entry of entries) {
		if (entry.family === 6) {
			continue;
		}

		entry.address = `::ffff:${entry.address}`;
		entry.family = 6;
	}
};

const getIfaceInfo = () => {
	let has4 = false;
	let has6 = false;

	for (const device of Object.values(os__default["default"].networkInterfaces())) {
		for (const iface of device) {
			if (iface.internal) {
				continue;
			}

			if (iface.family === 'IPv6') {
				has6 = true;
			} else {
				has4 = true;
			}

			if (has4 && has6) {
				return {has4, has6};
			}
		}
	}

	return {has4, has6};
};

const isIterable = map => {
	return Symbol.iterator in map;
};

const ttl = {ttl: true};
const all = {all: true};

class CacheableLookup {
	constructor({
		cache = new Map(),
		maxTtl = Infinity,
		fallbackDuration = 3600,
		errorTtl = 0.15,
		resolver = new AsyncResolver(),
		lookup = dnsLookup
	} = {}) {
		this.maxTtl = maxTtl;
		this.errorTtl = errorTtl;

		this._cache = cache;
		this._resolver = resolver;
		this._dnsLookup = promisify(lookup);

		if (this._resolver instanceof AsyncResolver) {
			this._resolve4 = this._resolver.resolve4.bind(this._resolver);
			this._resolve6 = this._resolver.resolve6.bind(this._resolver);
		} else {
			this._resolve4 = promisify(this._resolver.resolve4.bind(this._resolver));
			this._resolve6 = promisify(this._resolver.resolve6.bind(this._resolver));
		}

		this._iface = getIfaceInfo();

		this._pending = {};
		this._nextRemovalTime = false;
		this._hostnamesToFallback = new Set();

		if (fallbackDuration < 1) {
			this._fallback = false;
		} else {
			this._fallback = true;

			const interval = setInterval(() => {
				this._hostnamesToFallback.clear();
			}, fallbackDuration * 1000);

			/* istanbul ignore next: There is no `interval.unref()` when running inside an Electron renderer */
			if (interval.unref) {
				interval.unref();
			}
		}

		this.lookup = this.lookup.bind(this);
		this.lookupAsync = this.lookupAsync.bind(this);
	}

	set servers(servers) {
		this.clear();

		this._resolver.setServers(servers);
	}

	get servers() {
		return this._resolver.getServers();
	}

	lookup(hostname, options, callback) {
		if (typeof options === 'function') {
			callback = options;
			options = {};
		} else if (typeof options === 'number') {
			options = {
				family: options
			};
		}

		if (!callback) {
			throw new Error('Callback must be a function.');
		}

		// eslint-disable-next-line promise/prefer-await-to-then
		this.lookupAsync(hostname, options).then(result => {
			if (options.all) {
				callback(null, result);
			} else {
				callback(null, result.address, result.family, result.expires, result.ttl);
			}
		}, callback);
	}

	async lookupAsync(hostname, options = {}) {
		if (typeof options === 'number') {
			options = {
				family: options
			};
		}

		let cached = await this.query(hostname);

		if (options.family === 6) {
			const filtered = cached.filter(entry => entry.family === 6);

			if (options.hints & V4MAPPED) {
				if ((supportsALL && options.hints & ALL) || filtered.length === 0) {
					map4to6(cached);
				} else {
					cached = filtered;
				}
			} else {
				cached = filtered;
			}
		} else if (options.family === 4) {
			cached = cached.filter(entry => entry.family === 4);
		}

		if (options.hints & ADDRCONFIG) {
			const {_iface} = this;
			cached = cached.filter(entry => entry.family === 6 ? _iface.has6 : _iface.has4);
		}

		if (cached.length === 0) {
			const error = new Error(`cacheableLookup ENOTFOUND ${hostname}`);
			error.code = 'ENOTFOUND';
			error.hostname = hostname;

			throw error;
		}

		if (options.all) {
			return cached;
		}

		return cached[0];
	}

	async query(hostname) {
		let cached = await this._cache.get(hostname);

		if (!cached) {
			const pending = this._pending[hostname];

			if (pending) {
				cached = await pending;
			} else {
				const newPromise = this.queryAndCache(hostname);
				this._pending[hostname] = newPromise;

				try {
					cached = await newPromise;
				} finally {
					delete this._pending[hostname];
				}
			}
		}

		cached = cached.map(entry => {
			return {...entry};
		});

		return cached;
	}

	async _resolve(hostname) {
		const wrap = async promise => {
			try {
				return await promise;
			} catch (error) {
				if (error.code === 'ENODATA' || error.code === 'ENOTFOUND') {
					return [];
				}

				throw error;
			}
		};

		// ANY is unsafe as it doesn't trigger new queries in the underlying server.
		const [A, AAAA] = await Promise.all([
			this._resolve4(hostname, ttl),
			this._resolve6(hostname, ttl)
		].map(promise => wrap(promise)));

		let aTtl = 0;
		let aaaaTtl = 0;
		let cacheTtl = 0;

		const now = Date.now();

		for (const entry of A) {
			entry.family = 4;
			entry.expires = now + (entry.ttl * 1000);

			aTtl = Math.max(aTtl, entry.ttl);
		}

		for (const entry of AAAA) {
			entry.family = 6;
			entry.expires = now + (entry.ttl * 1000);

			aaaaTtl = Math.max(aaaaTtl, entry.ttl);
		}

		if (A.length > 0) {
			if (AAAA.length > 0) {
				cacheTtl = Math.min(aTtl, aaaaTtl);
			} else {
				cacheTtl = aTtl;
			}
		} else {
			cacheTtl = aaaaTtl;
		}

		return {
			entries: [
				...A,
				...AAAA
			],
			cacheTtl
		};
	}

	async _lookup(hostname) {
		try {
			const entries = await this._dnsLookup(hostname, {
				all: true
			});

			return {
				entries,
				cacheTtl: 0
			};
		} catch (_) {
			return {
				entries: [],
				cacheTtl: 0
			};
		}
	}

	async _set(hostname, data, cacheTtl) {
		if (this.maxTtl > 0 && cacheTtl > 0) {
			cacheTtl = Math.min(cacheTtl, this.maxTtl) * 1000;
			data[kExpires] = Date.now() + cacheTtl;

			try {
				await this._cache.set(hostname, data, cacheTtl);
			} catch (error) {
				this.lookupAsync = async () => {
					const cacheError = new Error('Cache Error. Please recreate the CacheableLookup instance.');
					cacheError.cause = error;

					throw cacheError;
				};
			}

			if (isIterable(this._cache)) {
				this._tick(cacheTtl);
			}
		}
	}

	async queryAndCache(hostname) {
		if (this._hostnamesToFallback.has(hostname)) {
			return this._dnsLookup(hostname, all);
		}

		let query = await this._resolve(hostname);

		if (query.entries.length === 0 && this._fallback) {
			query = await this._lookup(hostname);

			if (query.entries.length !== 0) {
				// Use `dns.lookup(...)` for that particular hostname
				this._hostnamesToFallback.add(hostname);
			}
		}

		const cacheTtl = query.entries.length === 0 ? this.errorTtl : query.cacheTtl;
		await this._set(hostname, query.entries, cacheTtl);

		return query.entries;
	}

	_tick(ms) {
		const nextRemovalTime = this._nextRemovalTime;

		if (!nextRemovalTime || ms < nextRemovalTime) {
			clearTimeout(this._removalTimeout);

			this._nextRemovalTime = ms;

			this._removalTimeout = setTimeout(() => {
				this._nextRemovalTime = false;

				let nextExpiry = Infinity;

				const now = Date.now();

				for (const [hostname, entries] of this._cache) {
					const expires = entries[kExpires];

					if (now >= expires) {
						this._cache.delete(hostname);
					} else if (expires < nextExpiry) {
						nextExpiry = expires;
					}
				}

				if (nextExpiry !== Infinity) {
					this._tick(nextExpiry - now);
				}
			}, ms);

			/* istanbul ignore next: There is no `timeout.unref()` when running inside an Electron renderer */
			if (this._removalTimeout.unref) {
				this._removalTimeout.unref();
			}
		}
	}

	install(agent) {
		verifyAgent(agent);

		if (kCacheableLookupCreateConnection in agent) {
			throw new Error('CacheableLookup has been already installed');
		}

		agent[kCacheableLookupCreateConnection] = agent.createConnection;
		agent[kCacheableLookupInstance] = this;

		agent.createConnection = (options, callback) => {
			if (!('lookup' in options)) {
				options.lookup = this.lookup;
			}

			return agent[kCacheableLookupCreateConnection](options, callback);
		};
	}

	uninstall(agent) {
		verifyAgent(agent);

		if (agent[kCacheableLookupCreateConnection]) {
			if (agent[kCacheableLookupInstance] !== this) {
				throw new Error('The agent is not owned by this CacheableLookup instance');
			}

			agent.createConnection = agent[kCacheableLookupCreateConnection];

			delete agent[kCacheableLookupCreateConnection];
			delete agent[kCacheableLookupInstance];
		}
	}

	updateInterfaceInfo() {
		const {_iface} = this;

		this._iface = getIfaceInfo();

		if ((_iface.has4 && !this._iface.has4) || (_iface.has6 && !this._iface.has6)) {
			this._cache.clear();
		}
	}

	clear(hostname) {
		if (hostname) {
			this._cache.delete(hostname);
			return;
		}

		this._cache.clear();
	}
}

var source$2 = CacheableLookup;
var _default$1 = CacheableLookup;
source$2.default = _default$1;

// https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URIs
const DATA_URL_DEFAULT_MIME_TYPE = 'text/plain';
const DATA_URL_DEFAULT_CHARSET = 'us-ascii';

const testParameter = (name, filters) => {
	return filters.some(filter => filter instanceof RegExp ? filter.test(name) : filter === name);
};

const normalizeDataURL = (urlString, {stripHash}) => {
	const match = /^data:(?<type>[^,]*?),(?<data>[^#]*?)(?:#(?<hash>.*))?$/.exec(urlString);

	if (!match) {
		throw new Error(`Invalid URL: ${urlString}`);
	}

	let {type, data, hash} = match.groups;
	const mediaType = type.split(';');
	hash = stripHash ? '' : hash;

	let isBase64 = false;
	if (mediaType[mediaType.length - 1] === 'base64') {
		mediaType.pop();
		isBase64 = true;
	}

	// Lowercase MIME type
	const mimeType = (mediaType.shift() || '').toLowerCase();
	const attributes = mediaType
		.map(attribute => {
			let [key, value = ''] = attribute.split('=').map(string => string.trim());

			// Lowercase `charset`
			if (key === 'charset') {
				value = value.toLowerCase();

				if (value === DATA_URL_DEFAULT_CHARSET) {
					return '';
				}
			}

			return `${key}${value ? `=${value}` : ''}`;
		})
		.filter(Boolean);

	const normalizedMediaType = [
		...attributes
	];

	if (isBase64) {
		normalizedMediaType.push('base64');
	}

	if (normalizedMediaType.length !== 0 || (mimeType && mimeType !== DATA_URL_DEFAULT_MIME_TYPE)) {
		normalizedMediaType.unshift(mimeType);
	}

	return `data:${normalizedMediaType.join(';')},${isBase64 ? data.trim() : data}${hash ? `#${hash}` : ''}`;
};

const normalizeUrl = (urlString, options) => {
	options = {
		defaultProtocol: 'http:',
		normalizeProtocol: true,
		forceHttp: false,
		forceHttps: false,
		stripAuthentication: true,
		stripHash: false,
		stripTextFragment: true,
		stripWWW: true,
		removeQueryParameters: [/^utm_\w+/i],
		removeTrailingSlash: true,
		removeSingleSlash: true,
		removeDirectoryIndex: false,
		sortQueryParameters: true,
		...options
	};

	urlString = urlString.trim();

	// Data URL
	if (/^data:/i.test(urlString)) {
		return normalizeDataURL(urlString, options);
	}

	if (/^view-source:/i.test(urlString)) {
		throw new Error('`view-source:` is not supported as it is a non-standard protocol');
	}

	const hasRelativeProtocol = urlString.startsWith('//');
	const isRelativeUrl = !hasRelativeProtocol && /^\.*\//.test(urlString);

	// Prepend protocol
	if (!isRelativeUrl) {
		urlString = urlString.replace(/^(?!(?:\w+:)?\/\/)|^\/\//, options.defaultProtocol);
	}

	const urlObj = new URL(urlString);

	if (options.forceHttp && options.forceHttps) {
		throw new Error('The `forceHttp` and `forceHttps` options cannot be used together');
	}

	if (options.forceHttp && urlObj.protocol === 'https:') {
		urlObj.protocol = 'http:';
	}

	if (options.forceHttps && urlObj.protocol === 'http:') {
		urlObj.protocol = 'https:';
	}

	// Remove auth
	if (options.stripAuthentication) {
		urlObj.username = '';
		urlObj.password = '';
	}

	// Remove hash
	if (options.stripHash) {
		urlObj.hash = '';
	} else if (options.stripTextFragment) {
		urlObj.hash = urlObj.hash.replace(/#?:~:text.*?$/i, '');
	}

	// Remove duplicate slashes if not preceded by a protocol
	if (urlObj.pathname) {
		urlObj.pathname = urlObj.pathname.replace(/(?<!\b(?:[a-z][a-z\d+\-.]{1,50}:))\/{2,}/g, '/');
	}

	// Decode URI octets
	if (urlObj.pathname) {
		try {
			urlObj.pathname = decodeURI(urlObj.pathname);
		} catch (_) {}
	}

	// Remove directory index
	if (options.removeDirectoryIndex === true) {
		options.removeDirectoryIndex = [/^index\.[a-z]+$/];
	}

	if (Array.isArray(options.removeDirectoryIndex) && options.removeDirectoryIndex.length > 0) {
		let pathComponents = urlObj.pathname.split('/');
		const lastComponent = pathComponents[pathComponents.length - 1];

		if (testParameter(lastComponent, options.removeDirectoryIndex)) {
			pathComponents = pathComponents.slice(0, pathComponents.length - 1);
			urlObj.pathname = pathComponents.slice(1).join('/') + '/';
		}
	}

	if (urlObj.hostname) {
		// Remove trailing dot
		urlObj.hostname = urlObj.hostname.replace(/\.$/, '');

		// Remove `www.`
		if (options.stripWWW && /^www\.(?!www\.)(?:[a-z\-\d]{1,63})\.(?:[a-z.\-\d]{2,63})$/.test(urlObj.hostname)) {
			// Each label should be max 63 at length (min: 1).
			// Source: https://en.wikipedia.org/wiki/Hostname#Restrictions_on_valid_host_names
			// Each TLD should be up to 63 characters long (min: 2).
			// It is technically possible to have a single character TLD, but none currently exist.
			urlObj.hostname = urlObj.hostname.replace(/^www\./, '');
		}
	}

	// Remove query unwanted parameters
	if (Array.isArray(options.removeQueryParameters)) {
		for (const key of [...urlObj.searchParams.keys()]) {
			if (testParameter(key, options.removeQueryParameters)) {
				urlObj.searchParams.delete(key);
			}
		}
	}

	if (options.removeQueryParameters === true) {
		urlObj.search = '';
	}

	// Sort query parameters
	if (options.sortQueryParameters) {
		urlObj.searchParams.sort();
	}

	if (options.removeTrailingSlash) {
		urlObj.pathname = urlObj.pathname.replace(/\/$/, '');
	}

	const oldUrlString = urlString;

	// Take advantage of many of the Node `url` normalizations
	urlString = urlObj.toString();

	if (!options.removeSingleSlash && urlObj.pathname === '/' && !oldUrlString.endsWith('/') && urlObj.hash === '') {
		urlString = urlString.replace(/\/$/, '');
	}

	// Remove ending `/` unless removeSingleSlash is false
	if ((options.removeTrailingSlash || urlObj.pathname === '/') && urlObj.hash === '' && options.removeSingleSlash) {
		urlString = urlString.replace(/\/$/, '');
	}

	// Restore relative protocol, if applicable
	if (hasRelativeProtocol && !options.normalizeProtocol) {
		urlString = urlString.replace(/^http:\/\//, '//');
	}

	// Remove http/https
	if (options.stripProtocol) {
		urlString = urlString.replace(/^(?:https?:)?\/\//, '');
	}

	return urlString;
};

var normalizeUrl_1 = normalizeUrl;

// Returns a wrapper function that returns a wrapped callback
// The wrapper function should do some stuff, and return a
// presumably different callback function.
// This makes sure that own properties are retained, so that
// decorations and such are not lost along the way.
var wrappy_1 = wrappy;
function wrappy (fn, cb) {
  if (fn && cb) return wrappy(fn)(cb)

  if (typeof fn !== 'function')
    throw new TypeError('need wrapper function')

  Object.keys(fn).forEach(function (k) {
    wrapper[k] = fn[k];
  });

  return wrapper

  function wrapper() {
    var args = new Array(arguments.length);
    for (var i = 0; i < args.length; i++) {
      args[i] = arguments[i];
    }
    var ret = fn.apply(this, args);
    var cb = args[args.length-1];
    if (typeof ret === 'function' && ret !== cb) {
      Object.keys(cb).forEach(function (k) {
        ret[k] = cb[k];
      });
    }
    return ret
  }
}

var once_1 = wrappy_1(once);
var strict = wrappy_1(onceStrict);

once.proto = once(function () {
  Object.defineProperty(Function.prototype, 'once', {
    value: function () {
      return once(this)
    },
    configurable: true
  });

  Object.defineProperty(Function.prototype, 'onceStrict', {
    value: function () {
      return onceStrict(this)
    },
    configurable: true
  });
});

function once (fn) {
  var f = function () {
    if (f.called) return f.value
    f.called = true;
    return f.value = fn.apply(this, arguments)
  };
  f.called = false;
  return f
}

function onceStrict (fn) {
  var f = function () {
    if (f.called)
      throw new Error(f.onceError)
    f.called = true;
    return f.value = fn.apply(this, arguments)
  };
  var name = fn.name || 'Function wrapped with `once`';
  f.onceError = name + " shouldn't be called more than once";
  f.called = false;
  return f
}
once_1.strict = strict;

var noop$1 = function() {};

var isRequest$1 = function(stream) {
	return stream.setHeader && typeof stream.abort === 'function';
};

var isChildProcess = function(stream) {
	return stream.stdio && Array.isArray(stream.stdio) && stream.stdio.length === 3
};

var eos = function(stream, opts, callback) {
	if (typeof opts === 'function') return eos(stream, null, opts);
	if (!opts) opts = {};

	callback = once_1(callback || noop$1);

	var ws = stream._writableState;
	var rs = stream._readableState;
	var readable = opts.readable || (opts.readable !== false && stream.readable);
	var writable = opts.writable || (opts.writable !== false && stream.writable);
	var cancelled = false;

	var onlegacyfinish = function() {
		if (!stream.writable) onfinish();
	};

	var onfinish = function() {
		writable = false;
		if (!readable) callback.call(stream);
	};

	var onend = function() {
		readable = false;
		if (!writable) callback.call(stream);
	};

	var onexit = function(exitCode) {
		callback.call(stream, exitCode ? new Error('exited with error code: ' + exitCode) : null);
	};

	var onerror = function(err) {
		callback.call(stream, err);
	};

	var onclose = function() {
		process.nextTick(onclosenexttick);
	};

	var onclosenexttick = function() {
		if (cancelled) return;
		if (readable && !(rs && (rs.ended && !rs.destroyed))) return callback.call(stream, new Error('premature close'));
		if (writable && !(ws && (ws.ended && !ws.destroyed))) return callback.call(stream, new Error('premature close'));
	};

	var onrequest = function() {
		stream.req.on('finish', onfinish);
	};

	if (isRequest$1(stream)) {
		stream.on('complete', onfinish);
		stream.on('abort', onclose);
		if (stream.req) onrequest();
		else stream.on('request', onrequest);
	} else if (writable && !ws) { // legacy streams
		stream.on('end', onlegacyfinish);
		stream.on('close', onlegacyfinish);
	}

	if (isChildProcess(stream)) stream.on('exit', onexit);

	stream.on('end', onend);
	stream.on('finish', onfinish);
	if (opts.error !== false) stream.on('error', onerror);
	stream.on('close', onclose);

	return function() {
		cancelled = true;
		stream.removeListener('complete', onfinish);
		stream.removeListener('abort', onclose);
		stream.removeListener('request', onrequest);
		if (stream.req) stream.req.removeListener('finish', onfinish);
		stream.removeListener('end', onlegacyfinish);
		stream.removeListener('close', onlegacyfinish);
		stream.removeListener('finish', onfinish);
		stream.removeListener('exit', onexit);
		stream.removeListener('end', onend);
		stream.removeListener('error', onerror);
		stream.removeListener('close', onclose);
	};
};

var endOfStream = eos;

// we only need fs to get the ReadStream and WriteStream prototypes

var noop = function () {};
var ancient = /^v?\.0/.test(process.version);

var isFn = function (fn) {
  return typeof fn === 'function'
};

var isFS = function (stream) {
  if (!ancient) return false // newer node version do not need to care about fs is a special way
  if (!fs__default["default"]) return false // browser
  return (stream instanceof (fs__default["default"].ReadStream || noop) || stream instanceof (fs__default["default"].WriteStream || noop)) && isFn(stream.close)
};

var isRequest = function (stream) {
  return stream.setHeader && isFn(stream.abort)
};

var destroyer = function (stream, reading, writing, callback) {
  callback = once_1(callback);

  var closed = false;
  stream.on('close', function () {
    closed = true;
  });

  endOfStream(stream, {readable: reading, writable: writing}, function (err) {
    if (err) return callback(err)
    closed = true;
    callback();
  });

  var destroyed = false;
  return function (err) {
    if (closed) return
    if (destroyed) return
    destroyed = true;

    if (isFS(stream)) return stream.close(noop) // use close for fs streams to avoid fd leaks
    if (isRequest(stream)) return stream.abort() // request.destroy just do .end - .abort is what we want

    if (isFn(stream.destroy)) return stream.destroy()

    callback(err || new Error('stream was destroyed'));
  }
};

var call = function (fn) {
  fn();
};

var pipe = function (from, to) {
  return from.pipe(to)
};

var pump = function () {
  var streams = Array.prototype.slice.call(arguments);
  var callback = isFn(streams[streams.length - 1] || noop) && streams.pop() || noop;

  if (Array.isArray(streams[0])) streams = streams[0];
  if (streams.length < 2) throw new Error('pump requires two streams per minimum')

  var error;
  var destroys = streams.map(function (stream, i) {
    var reading = i < streams.length - 1;
    var writing = i > 0;
    return destroyer(stream, reading, writing, function (err) {
      if (!error) error = err;
      if (err) destroys.forEach(call);
      if (reading) return
      destroys.forEach(call);
      callback(error);
    })
  });

  return streams.reduce(pipe)
};

var pump_1 = pump;

const {PassThrough: PassThroughStream} = require$$0__default$2["default"];

var bufferStream = options => {
	options = {...options};

	const {array} = options;
	let {encoding} = options;
	const isBuffer = encoding === 'buffer';
	let objectMode = false;

	if (array) {
		objectMode = !(encoding || isBuffer);
	} else {
		encoding = encoding || 'utf8';
	}

	if (isBuffer) {
		encoding = null;
	}

	const stream = new PassThroughStream({objectMode});

	if (encoding) {
		stream.setEncoding(encoding);
	}

	let length = 0;
	const chunks = [];

	stream.on('data', chunk => {
		chunks.push(chunk);

		if (objectMode) {
			length = chunks.length;
		} else {
			length += chunk.length;
		}
	});

	stream.getBufferedValue = () => {
		if (array) {
			return chunks;
		}

		return isBuffer ? Buffer.concat(chunks, length) : chunks.join('');
	};

	stream.getBufferedLength = () => length;

	return stream;
};

const {constants: BufferConstants} = require$$0__default$3["default"];



class MaxBufferError extends Error {
	constructor() {
		super('maxBuffer exceeded');
		this.name = 'MaxBufferError';
	}
}

async function getStream(inputStream, options) {
	if (!inputStream) {
		return Promise.reject(new Error('Expected a stream'));
	}

	options = {
		maxBuffer: Infinity,
		...options
	};

	const {maxBuffer} = options;

	let stream;
	await new Promise((resolve, reject) => {
		const rejectPromise = error => {
			// Don't retrieve an oversized buffer.
			if (error && stream.getBufferedLength() <= BufferConstants.MAX_LENGTH) {
				error.bufferedData = stream.getBufferedValue();
			}

			reject(error);
		};

		stream = pump_1(inputStream, bufferStream(options), error => {
			if (error) {
				rejectPromise(error);
				return;
			}

			resolve();
		});

		stream.on('data', () => {
			if (stream.getBufferedLength() > maxBuffer) {
				rejectPromise(new MaxBufferError());
			}
		});
	});

	return stream.getBufferedValue();
}

var getStream_1 = getStream;
// TODO: Remove this for the next major release
var _default = getStream;
var buffer = (stream, options) => getStream(stream, {...options, encoding: 'buffer'});
var array = (stream, options) => getStream(stream, {...options, array: true});
var MaxBufferError_1 = MaxBufferError;
getStream_1.default = _default;
getStream_1.buffer = buffer;
getStream_1.array = array;
getStream_1.MaxBufferError = MaxBufferError_1;

// rfc7231 6.1
const statusCodeCacheableByDefault = new Set([
    200,
    203,
    204,
    206,
    300,
    301,
    308,
    404,
    405,
    410,
    414,
    501,
]);

// This implementation does not understand partial responses (206)
const understoodStatuses = new Set([
    200,
    203,
    204,
    300,
    301,
    302,
    303,
    307,
    308,
    404,
    405,
    410,
    414,
    501,
]);

const errorStatusCodes = new Set([
    500,
    502,
    503, 
    504,
]);

const hopByHopHeaders = {
    date: true, // included, because we add Age update Date
    connection: true,
    'keep-alive': true,
    'proxy-authenticate': true,
    'proxy-authorization': true,
    te: true,
    trailer: true,
    'transfer-encoding': true,
    upgrade: true,
};

const excludedFromRevalidationUpdate = {
    // Since the old body is reused, it doesn't make sense to change properties of the body
    'content-length': true,
    'content-encoding': true,
    'transfer-encoding': true,
    'content-range': true,
};

function toNumberOrZero(s) {
    const n = parseInt(s, 10);
    return isFinite(n) ? n : 0;
}

// RFC 5861
function isErrorResponse(response) {
    // consider undefined response as faulty
    if(!response) {
        return true
    }
    return errorStatusCodes.has(response.status);
}

function parseCacheControl(header) {
    const cc = {};
    if (!header) return cc;

    // TODO: When there is more than one value present for a given directive (e.g., two Expires header fields, multiple Cache-Control: max-age directives),
    // the directive's value is considered invalid. Caches are encouraged to consider responses that have invalid freshness information to be stale
    const parts = header.trim().split(/,/);
    for (const part of parts) {
        const [k, v] = part.split(/=/, 2);
        cc[k.trim()] = v === undefined ? true : v.trim().replace(/^"|"$/g, '');
    }

    return cc;
}

function formatCacheControl(cc) {
    let parts = [];
    for (const k in cc) {
        const v = cc[k];
        parts.push(v === true ? k : k + '=' + v);
    }
    if (!parts.length) {
        return undefined;
    }
    return parts.join(', ');
}

var httpCacheSemantics = class CachePolicy {
    constructor(
        req,
        res,
        {
            shared,
            cacheHeuristic,
            immutableMinTimeToLive,
            ignoreCargoCult,
            _fromObject,
        } = {}
    ) {
        if (_fromObject) {
            this._fromObject(_fromObject);
            return;
        }

        if (!res || !res.headers) {
            throw Error('Response headers missing');
        }
        this._assertRequestHasHeaders(req);

        this._responseTime = this.now();
        this._isShared = shared !== false;
        this._cacheHeuristic =
            undefined !== cacheHeuristic ? cacheHeuristic : 0.1; // 10% matches IE
        this._immutableMinTtl =
            undefined !== immutableMinTimeToLive
                ? immutableMinTimeToLive
                : 24 * 3600 * 1000;

        this._status = 'status' in res ? res.status : 200;
        this._resHeaders = res.headers;
        this._rescc = parseCacheControl(res.headers['cache-control']);
        this._method = 'method' in req ? req.method : 'GET';
        this._url = req.url;
        this._host = req.headers.host;
        this._noAuthorization = !req.headers.authorization;
        this._reqHeaders = res.headers.vary ? req.headers : null; // Don't keep all request headers if they won't be used
        this._reqcc = parseCacheControl(req.headers['cache-control']);

        // Assume that if someone uses legacy, non-standard uncecessary options they don't understand caching,
        // so there's no point stricly adhering to the blindly copy&pasted directives.
        if (
            ignoreCargoCult &&
            'pre-check' in this._rescc &&
            'post-check' in this._rescc
        ) {
            delete this._rescc['pre-check'];
            delete this._rescc['post-check'];
            delete this._rescc['no-cache'];
            delete this._rescc['no-store'];
            delete this._rescc['must-revalidate'];
            this._resHeaders = Object.assign({}, this._resHeaders, {
                'cache-control': formatCacheControl(this._rescc),
            });
            delete this._resHeaders.expires;
            delete this._resHeaders.pragma;
        }

        // When the Cache-Control header field is not present in a request, caches MUST consider the no-cache request pragma-directive
        // as having the same effect as if "Cache-Control: no-cache" were present (see Section 5.2.1).
        if (
            res.headers['cache-control'] == null &&
            /no-cache/.test(res.headers.pragma)
        ) {
            this._rescc['no-cache'] = true;
        }
    }

    now() {
        return Date.now();
    }

    storable() {
        // The "no-store" request directive indicates that a cache MUST NOT store any part of either this request or any response to it.
        return !!(
            !this._reqcc['no-store'] &&
            // A cache MUST NOT store a response to any request, unless:
            // The request method is understood by the cache and defined as being cacheable, and
            ('GET' === this._method ||
                'HEAD' === this._method ||
                ('POST' === this._method && this._hasExplicitExpiration())) &&
            // the response status code is understood by the cache, and
            understoodStatuses.has(this._status) &&
            // the "no-store" cache directive does not appear in request or response header fields, and
            !this._rescc['no-store'] &&
            // the "private" response directive does not appear in the response, if the cache is shared, and
            (!this._isShared || !this._rescc.private) &&
            // the Authorization header field does not appear in the request, if the cache is shared,
            (!this._isShared ||
                this._noAuthorization ||
                this._allowsStoringAuthenticated()) &&
            // the response either:
            // contains an Expires header field, or
            (this._resHeaders.expires ||
                // contains a max-age response directive, or
                // contains a s-maxage response directive and the cache is shared, or
                // contains a public response directive.
                this._rescc['max-age'] ||
                (this._isShared && this._rescc['s-maxage']) ||
                this._rescc.public ||
                // has a status code that is defined as cacheable by default
                statusCodeCacheableByDefault.has(this._status))
        );
    }

    _hasExplicitExpiration() {
        // 4.2.1 Calculating Freshness Lifetime
        return (
            (this._isShared && this._rescc['s-maxage']) ||
            this._rescc['max-age'] ||
            this._resHeaders.expires
        );
    }

    _assertRequestHasHeaders(req) {
        if (!req || !req.headers) {
            throw Error('Request headers missing');
        }
    }

    satisfiesWithoutRevalidation(req) {
        this._assertRequestHasHeaders(req);

        // When presented with a request, a cache MUST NOT reuse a stored response, unless:
        // the presented request does not contain the no-cache pragma (Section 5.4), nor the no-cache cache directive,
        // unless the stored response is successfully validated (Section 4.3), and
        const requestCC = parseCacheControl(req.headers['cache-control']);
        if (requestCC['no-cache'] || /no-cache/.test(req.headers.pragma)) {
            return false;
        }

        if (requestCC['max-age'] && this.age() > requestCC['max-age']) {
            return false;
        }

        if (
            requestCC['min-fresh'] &&
            this.timeToLive() < 1000 * requestCC['min-fresh']
        ) {
            return false;
        }

        // the stored response is either:
        // fresh, or allowed to be served stale
        if (this.stale()) {
            const allowsStale =
                requestCC['max-stale'] &&
                !this._rescc['must-revalidate'] &&
                (true === requestCC['max-stale'] ||
                    requestCC['max-stale'] > this.age() - this.maxAge());
            if (!allowsStale) {
                return false;
            }
        }

        return this._requestMatches(req, false);
    }

    _requestMatches(req, allowHeadMethod) {
        // The presented effective request URI and that of the stored response match, and
        return (
            (!this._url || this._url === req.url) &&
            this._host === req.headers.host &&
            // the request method associated with the stored response allows it to be used for the presented request, and
            (!req.method ||
                this._method === req.method ||
                (allowHeadMethod && 'HEAD' === req.method)) &&
            // selecting header fields nominated by the stored response (if any) match those presented, and
            this._varyMatches(req)
        );
    }

    _allowsStoringAuthenticated() {
        //  following Cache-Control response directives (Section 5.2.2) have such an effect: must-revalidate, public, and s-maxage.
        return (
            this._rescc['must-revalidate'] ||
            this._rescc.public ||
            this._rescc['s-maxage']
        );
    }

    _varyMatches(req) {
        if (!this._resHeaders.vary) {
            return true;
        }

        // A Vary header field-value of "*" always fails to match
        if (this._resHeaders.vary === '*') {
            return false;
        }

        const fields = this._resHeaders.vary
            .trim()
            .toLowerCase()
            .split(/\s*,\s*/);
        for (const name of fields) {
            if (req.headers[name] !== this._reqHeaders[name]) return false;
        }
        return true;
    }

    _copyWithoutHopByHopHeaders(inHeaders) {
        const headers = {};
        for (const name in inHeaders) {
            if (hopByHopHeaders[name]) continue;
            headers[name] = inHeaders[name];
        }
        // 9.1.  Connection
        if (inHeaders.connection) {
            const tokens = inHeaders.connection.trim().split(/\s*,\s*/);
            for (const name of tokens) {
                delete headers[name];
            }
        }
        if (headers.warning) {
            const warnings = headers.warning.split(/,/).filter(warning => {
                return !/^\s*1[0-9][0-9]/.test(warning);
            });
            if (!warnings.length) {
                delete headers.warning;
            } else {
                headers.warning = warnings.join(',').trim();
            }
        }
        return headers;
    }

    responseHeaders() {
        const headers = this._copyWithoutHopByHopHeaders(this._resHeaders);
        const age = this.age();

        // A cache SHOULD generate 113 warning if it heuristically chose a freshness
        // lifetime greater than 24 hours and the response's age is greater than 24 hours.
        if (
            age > 3600 * 24 &&
            !this._hasExplicitExpiration() &&
            this.maxAge() > 3600 * 24
        ) {
            headers.warning =
                (headers.warning ? `${headers.warning}, ` : '') +
                '113 - "rfc7234 5.5.4"';
        }
        headers.age = `${Math.round(age)}`;
        headers.date = new Date(this.now()).toUTCString();
        return headers;
    }

    /**
     * Value of the Date response header or current time if Date was invalid
     * @return timestamp
     */
    date() {
        const serverDate = Date.parse(this._resHeaders.date);
        if (isFinite(serverDate)) {
            return serverDate;
        }
        return this._responseTime;
    }

    /**
     * Value of the Age header, in seconds, updated for the current time.
     * May be fractional.
     *
     * @return Number
     */
    age() {
        let age = this._ageValue();

        const residentTime = (this.now() - this._responseTime) / 1000;
        return age + residentTime;
    }

    _ageValue() {
        return toNumberOrZero(this._resHeaders.age);
    }

    /**
     * Value of applicable max-age (or heuristic equivalent) in seconds. This counts since response's `Date`.
     *
     * For an up-to-date value, see `timeToLive()`.
     *
     * @return Number
     */
    maxAge() {
        if (!this.storable() || this._rescc['no-cache']) {
            return 0;
        }

        // Shared responses with cookies are cacheable according to the RFC, but IMHO it'd be unwise to do so by default
        // so this implementation requires explicit opt-in via public header
        if (
            this._isShared &&
            (this._resHeaders['set-cookie'] &&
                !this._rescc.public &&
                !this._rescc.immutable)
        ) {
            return 0;
        }

        if (this._resHeaders.vary === '*') {
            return 0;
        }

        if (this._isShared) {
            if (this._rescc['proxy-revalidate']) {
                return 0;
            }
            // if a response includes the s-maxage directive, a shared cache recipient MUST ignore the Expires field.
            if (this._rescc['s-maxage']) {
                return toNumberOrZero(this._rescc['s-maxage']);
            }
        }

        // If a response includes a Cache-Control field with the max-age directive, a recipient MUST ignore the Expires field.
        if (this._rescc['max-age']) {
            return toNumberOrZero(this._rescc['max-age']);
        }

        const defaultMinTtl = this._rescc.immutable ? this._immutableMinTtl : 0;

        const serverDate = this.date();
        if (this._resHeaders.expires) {
            const expires = Date.parse(this._resHeaders.expires);
            // A cache recipient MUST interpret invalid date formats, especially the value "0", as representing a time in the past (i.e., "already expired").
            if (Number.isNaN(expires) || expires < serverDate) {
                return 0;
            }
            return Math.max(defaultMinTtl, (expires - serverDate) / 1000);
        }

        if (this._resHeaders['last-modified']) {
            const lastModified = Date.parse(this._resHeaders['last-modified']);
            if (isFinite(lastModified) && serverDate > lastModified) {
                return Math.max(
                    defaultMinTtl,
                    ((serverDate - lastModified) / 1000) * this._cacheHeuristic
                );
            }
        }

        return defaultMinTtl;
    }

    timeToLive() {
        const age = this.maxAge() - this.age();
        const staleIfErrorAge = age + toNumberOrZero(this._rescc['stale-if-error']);
        const staleWhileRevalidateAge = age + toNumberOrZero(this._rescc['stale-while-revalidate']);
        return Math.max(0, age, staleIfErrorAge, staleWhileRevalidateAge) * 1000;
    }

    stale() {
        return this.maxAge() <= this.age();
    }

    _useStaleIfError() {
        return this.maxAge() + toNumberOrZero(this._rescc['stale-if-error']) > this.age();
    }

    useStaleWhileRevalidate() {
        return this.maxAge() + toNumberOrZero(this._rescc['stale-while-revalidate']) > this.age();
    }

    static fromObject(obj) {
        return new this(undefined, undefined, { _fromObject: obj });
    }

    _fromObject(obj) {
        if (this._responseTime) throw Error('Reinitialized');
        if (!obj || obj.v !== 1) throw Error('Invalid serialization');

        this._responseTime = obj.t;
        this._isShared = obj.sh;
        this._cacheHeuristic = obj.ch;
        this._immutableMinTtl =
            obj.imm !== undefined ? obj.imm : 24 * 3600 * 1000;
        this._status = obj.st;
        this._resHeaders = obj.resh;
        this._rescc = obj.rescc;
        this._method = obj.m;
        this._url = obj.u;
        this._host = obj.h;
        this._noAuthorization = obj.a;
        this._reqHeaders = obj.reqh;
        this._reqcc = obj.reqcc;
    }

    toObject() {
        return {
            v: 1,
            t: this._responseTime,
            sh: this._isShared,
            ch: this._cacheHeuristic,
            imm: this._immutableMinTtl,
            st: this._status,
            resh: this._resHeaders,
            rescc: this._rescc,
            m: this._method,
            u: this._url,
            h: this._host,
            a: this._noAuthorization,
            reqh: this._reqHeaders,
            reqcc: this._reqcc,
        };
    }

    /**
     * Headers for sending to the origin server to revalidate stale response.
     * Allows server to return 304 to allow reuse of the previous response.
     *
     * Hop by hop headers are always stripped.
     * Revalidation headers may be added or removed, depending on request.
     */
    revalidationHeaders(incomingReq) {
        this._assertRequestHasHeaders(incomingReq);
        const headers = this._copyWithoutHopByHopHeaders(incomingReq.headers);

        // This implementation does not understand range requests
        delete headers['if-range'];

        if (!this._requestMatches(incomingReq, true) || !this.storable()) {
            // revalidation allowed via HEAD
            // not for the same resource, or wasn't allowed to be cached anyway
            delete headers['if-none-match'];
            delete headers['if-modified-since'];
            return headers;
        }

        /* MUST send that entity-tag in any cache validation request (using If-Match or If-None-Match) if an entity-tag has been provided by the origin server. */
        if (this._resHeaders.etag) {
            headers['if-none-match'] = headers['if-none-match']
                ? `${headers['if-none-match']}, ${this._resHeaders.etag}`
                : this._resHeaders.etag;
        }

        // Clients MAY issue simple (non-subrange) GET requests with either weak validators or strong validators. Clients MUST NOT use weak validators in other forms of request.
        const forbidsWeakValidators =
            headers['accept-ranges'] ||
            headers['if-match'] ||
            headers['if-unmodified-since'] ||
            (this._method && this._method != 'GET');

        /* SHOULD send the Last-Modified value in non-subrange cache validation requests (using If-Modified-Since) if only a Last-Modified value has been provided by the origin server.
        Note: This implementation does not understand partial responses (206) */
        if (forbidsWeakValidators) {
            delete headers['if-modified-since'];

            if (headers['if-none-match']) {
                const etags = headers['if-none-match']
                    .split(/,/)
                    .filter(etag => {
                        return !/^\s*W\//.test(etag);
                    });
                if (!etags.length) {
                    delete headers['if-none-match'];
                } else {
                    headers['if-none-match'] = etags.join(',').trim();
                }
            }
        } else if (
            this._resHeaders['last-modified'] &&
            !headers['if-modified-since']
        ) {
            headers['if-modified-since'] = this._resHeaders['last-modified'];
        }

        return headers;
    }

    /**
     * Creates new CachePolicy with information combined from the previews response,
     * and the new revalidation response.
     *
     * Returns {policy, modified} where modified is a boolean indicating
     * whether the response body has been modified, and old cached body can't be used.
     *
     * @return {Object} {policy: CachePolicy, modified: Boolean}
     */
    revalidatedPolicy(request, response) {
        this._assertRequestHasHeaders(request);
        if(this._useStaleIfError() && isErrorResponse(response)) {  // I consider the revalidation request unsuccessful
          return {
            modified: false,
            matches: false,
            policy: this,
          };
        }
        if (!response || !response.headers) {
            throw Error('Response headers missing');
        }

        // These aren't going to be supported exactly, since one CachePolicy object
        // doesn't know about all the other cached objects.
        let matches = false;
        if (response.status !== undefined && response.status != 304) {
            matches = false;
        } else if (
            response.headers.etag &&
            !/^\s*W\//.test(response.headers.etag)
        ) {
            // "All of the stored responses with the same strong validator are selected.
            // If none of the stored responses contain the same strong validator,
            // then the cache MUST NOT use the new response to update any stored responses."
            matches =
                this._resHeaders.etag &&
                this._resHeaders.etag.replace(/^\s*W\//, '') ===
                    response.headers.etag;
        } else if (this._resHeaders.etag && response.headers.etag) {
            // "If the new response contains a weak validator and that validator corresponds
            // to one of the cache's stored responses,
            // then the most recent of those matching stored responses is selected for update."
            matches =
                this._resHeaders.etag.replace(/^\s*W\//, '') ===
                response.headers.etag.replace(/^\s*W\//, '');
        } else if (this._resHeaders['last-modified']) {
            matches =
                this._resHeaders['last-modified'] ===
                response.headers['last-modified'];
        } else {
            // If the new response does not include any form of validator (such as in the case where
            // a client generates an If-Modified-Since request from a source other than the Last-Modified
            // response header field), and there is only one stored response, and that stored response also
            // lacks a validator, then that stored response is selected for update.
            if (
                !this._resHeaders.etag &&
                !this._resHeaders['last-modified'] &&
                !response.headers.etag &&
                !response.headers['last-modified']
            ) {
                matches = true;
            }
        }

        if (!matches) {
            return {
                policy: new this.constructor(request, response),
                // Client receiving 304 without body, even if it's invalid/mismatched has no option
                // but to reuse a cached body. We don't have a good way to tell clients to do
                // error recovery in such case.
                modified: response.status != 304,
                matches: false,
            };
        }

        // use other header fields provided in the 304 (Not Modified) response to replace all instances
        // of the corresponding header fields in the stored response.
        const headers = {};
        for (const k in this._resHeaders) {
            headers[k] =
                k in response.headers && !excludedFromRevalidationUpdate[k]
                    ? response.headers[k]
                    : this._resHeaders[k];
        }

        const newResponse = Object.assign({}, response, {
            status: this._status,
            method: this._method,
            headers,
        });
        return {
            policy: new this.constructor(request, newResponse, {
                shared: this._isShared,
                cacheHeuristic: this._cacheHeuristic,
                immutableMinTimeToLive: this._immutableMinTtl,
            }),
            modified: false,
            matches: true,
        };
    }
};

var lowercaseKeys = object => {
	const result = {};

	for (const [key, value] of Object.entries(object)) {
		result[key.toLowerCase()] = value;
	}

	return result;
};

const Readable$1 = require$$0__default$2["default"].Readable;


class Response extends Readable$1 {
	constructor(statusCode, headers, body, url) {
		if (typeof statusCode !== 'number') {
			throw new TypeError('Argument `statusCode` should be a number');
		}
		if (typeof headers !== 'object') {
			throw new TypeError('Argument `headers` should be an object');
		}
		if (!(body instanceof Buffer)) {
			throw new TypeError('Argument `body` should be a buffer');
		}
		if (typeof url !== 'string') {
			throw new TypeError('Argument `url` should be a string');
		}

		super();
		this.statusCode = statusCode;
		this.headers = lowercaseKeys(headers);
		this.body = body;
		this.url = url;
	}

	_read() {
		this.push(this.body);
		this.push(null);
	}
}

var src$3 = Response;

// We define these manually to ensure they're always copied
// even if they would move up the prototype chain
// https://nodejs.org/api/http.html#http_class_http_incomingmessage
const knownProps = [
	'destroy',
	'setTimeout',
	'socket',
	'headers',
	'trailers',
	'rawHeaders',
	'statusCode',
	'httpVersion',
	'httpVersionMinor',
	'httpVersionMajor',
	'rawTrailers',
	'statusMessage'
];

var mimicResponse$1 = (fromStream, toStream) => {
	const fromProps = new Set(Object.keys(fromStream).concat(knownProps));

	for (const prop of fromProps) {
		// Don't overwrite existing properties
		if (prop in toStream) {
			continue;
		}

		toStream[prop] = typeof fromStream[prop] === 'function' ? fromStream[prop].bind(fromStream) : fromStream[prop];
	}
};

const PassThrough$1 = require$$0__default$2["default"].PassThrough;


const cloneResponse = response => {
	if (!(response && response.pipe)) {
		throw new TypeError('Parameter `response` must be a response stream.');
	}

	const clone = new PassThrough$1();
	mimicResponse$1(response, clone);

	return response.pipe(clone);
};

var src$2 = cloneResponse;

//TODO: handle reviver/dehydrate function like normal
//and handle indentation, like normal.
//if anyone needs this... please send pull request.

var stringify = function stringify (o) {
  if('undefined' == typeof o) return o

  if(o && Buffer.isBuffer(o))
    return JSON.stringify(':base64:' + o.toString('base64'))

  if(o && o.toJSON)
    o =  o.toJSON();

  if(o && 'object' === typeof o) {
    var s = '';
    var array = Array.isArray(o);
    s = array ? '[' : '{';
    var first = true;

    for(var k in o) {
      var ignore = 'function' == typeof o[k] || (!array && 'undefined' === typeof o[k]);
      if(Object.hasOwnProperty.call(o, k) && !ignore) {
        if(!first)
          s += ',';
        first = false;
        if (array) {
          if(o[k] == undefined)
            s += 'null';
          else
            s += stringify(o[k]);
        } else if (o[k] !== void(0)) {
          s += stringify(k) + ':' + stringify(o[k]);
        }
      }
    }

    s += array ? ']' : '}';

    return s
  } else if ('string' === typeof o) {
    return JSON.stringify(/^:/.test(o) ? ':' + o : o)
  } else if ('undefined' === typeof o) {
    return 'null';
  } else
    return JSON.stringify(o)
};

var parse = function (s) {
  return JSON.parse(s, function (key, value) {
    if('string' === typeof value) {
      if(/^:base64:/.test(value))
        return Buffer.from(value.substring(8), 'base64')
      else
        return /^:/.test(value) ? value.substring(1) : value 
    }
    return value
  })
};

var jsonBuffer = {
	stringify: stringify,
	parse: parse
};

const loadStore = options => {
	if (options.adapter || options.uri) {
		options.adapter || /^[^:+]*/.exec(options.uri)[0];
		return new (commonjsRequire())(options);
	}

	return new Map();
};

const iterableAdapters = [
	'sqlite',
	'postgres',
	'mysql',
	'mongo',
	'redis',
	'tiered',
];

class Keyv extends EventEmitter__default["default"] {
	constructor(uri, {emitErrors = true, ...options} = {}) {
		super();
		this.opts = {
			namespace: 'keyv',
			serialize: jsonBuffer.stringify,
			deserialize: jsonBuffer.parse,
			...((typeof uri === 'string') ? {uri} : uri),
			...options,
		};

		if (!this.opts.store) {
			const adapterOptions = {...this.opts};
			this.opts.store = loadStore(adapterOptions);
		}

		if (this.opts.compression) {
			const compression = this.opts.compression;
			this.opts.serialize = compression.serialize.bind(compression);
			this.opts.deserialize = compression.deserialize.bind(compression);
		}

		if (typeof this.opts.store.on === 'function' && emitErrors) {
			this.opts.store.on('error', error => this.emit('error', error));
		}

		this.opts.store.namespace = this.opts.namespace;

		const generateIterator = iterator => async function * () {
			for await (const [key, raw] of typeof iterator === 'function'
				? iterator(this.opts.store.namespace)
				: iterator) {
				const data = await this.opts.deserialize(raw);
				if (this.opts.store.namespace && !key.includes(this.opts.store.namespace)) {
					continue;
				}

				if (typeof data.expires === 'number' && Date.now() > data.expires) {
					this.delete(key);
					continue;
				}

				yield [this._getKeyUnprefix(key), data.value];
			}
		};

		// Attach iterators
		if (typeof this.opts.store[Symbol.iterator] === 'function' && this.opts.store instanceof Map) {
			this.iterator = generateIterator(this.opts.store);
		} else if (typeof this.opts.store.iterator === 'function' && this.opts.store.opts
			&& this._checkIterableAdaptar()) {
			this.iterator = generateIterator(this.opts.store.iterator.bind(this.opts.store));
		}
	}

	_checkIterableAdaptar() {
		return iterableAdapters.includes(this.opts.store.opts.dialect)
			|| iterableAdapters.findIndex(element => this.opts.store.opts.url.includes(element)) >= 0;
	}

	_getKeyPrefix(key) {
		return `${this.opts.namespace}:${key}`;
	}

	_getKeyPrefixArray(keys) {
		return keys.map(key => `${this.opts.namespace}:${key}`);
	}

	_getKeyUnprefix(key) {
		return key
			.split(':')
			.splice(1)
			.join(':');
	}

	get(key, options) {
		const {store} = this.opts;
		const isArray = Array.isArray(key);
		const keyPrefixed = isArray ? this._getKeyPrefixArray(key) : this._getKeyPrefix(key);
		if (isArray && store.getMany === undefined) {
			const promises = [];
			for (const key of keyPrefixed) {
				promises.push(Promise.resolve()
					.then(() => store.get(key))
					.then(data => (typeof data === 'string') ? this.opts.deserialize(data) : (this.opts.compression ? this.opts.deserialize(data) : data))
					.then(data => {
						if (data === undefined || data === null) {
							return undefined;
						}

						if (typeof data.expires === 'number' && Date.now() > data.expires) {
							return this.delete(key).then(() => undefined);
						}

						return (options && options.raw) ? data : data.value;
					}),
				);
			}

			return Promise.allSettled(promises)
				.then(values => {
					const data = [];
					for (const value of values) {
						data.push(value.value);
					}

					return data;
				});
		}

		return Promise.resolve()
			.then(() => isArray ? store.getMany(keyPrefixed) : store.get(keyPrefixed))
			.then(data => (typeof data === 'string') ? this.opts.deserialize(data) : (this.opts.compression ? this.opts.deserialize(data) : data))
			.then(data => {
				if (data === undefined || data === null) {
					return undefined;
				}

				if (isArray) {
					return data.map((row, index) => {
						if ((typeof row === 'string')) {
							row = this.opts.deserialize(row);
						}

						if (row === undefined || row === null) {
							return undefined;
						}

						if (typeof row.expires === 'number' && Date.now() > row.expires) {
							this.delete(key[index]).then(() => undefined);
							return undefined;
						}

						return (options && options.raw) ? row : row.value;
					});
				}

				if (typeof data.expires === 'number' && Date.now() > data.expires) {
					return this.delete(key).then(() => undefined);
				}

				return (options && options.raw) ? data : data.value;
			});
	}

	set(key, value, ttl) {
		const keyPrefixed = this._getKeyPrefix(key);
		if (typeof ttl === 'undefined') {
			ttl = this.opts.ttl;
		}

		if (ttl === 0) {
			ttl = undefined;
		}

		const {store} = this.opts;

		return Promise.resolve()
			.then(() => {
				const expires = (typeof ttl === 'number') ? (Date.now() + ttl) : null;
				if (typeof value === 'symbol') {
					this.emit('error', 'symbol cannot be serialized');
				}

				value = {value, expires};
				return this.opts.serialize(value);
			})
			.then(value => store.set(keyPrefixed, value, ttl))
			.then(() => true);
	}

	delete(key) {
		const {store} = this.opts;
		if (Array.isArray(key)) {
			const keyPrefixed = this._getKeyPrefixArray(key);
			if (store.deleteMany === undefined) {
				const promises = [];
				for (const key of keyPrefixed) {
					promises.push(store.delete(key));
				}

				return Promise.allSettled(promises)
					.then(values => values.every(x => x.value === true));
			}

			return Promise.resolve()
				.then(() => store.deleteMany(keyPrefixed));
		}

		const keyPrefixed = this._getKeyPrefix(key);
		return Promise.resolve()
			.then(() => store.delete(keyPrefixed));
	}

	clear() {
		const {store} = this.opts;
		return Promise.resolve()
			.then(() => store.clear());
	}

	has(key) {
		const keyPrefixed = this._getKeyPrefix(key);
		const {store} = this.opts;
		return Promise.resolve()
			.then(async () => {
				if (typeof store.has === 'function') {
					return store.has(keyPrefixed);
				}

				const value = await store.get(keyPrefixed);
				return value !== undefined;
			});
	}

	disconnect() {
		const {store} = this.opts;
		if (typeof store.disconnect === 'function') {
			return store.disconnect();
		}
	}
}

var src$1 = Keyv;

class CacheableRequest {
	constructor(request, cacheAdapter) {
		if (typeof request !== 'function') {
			throw new TypeError('Parameter `request` must be a function');
		}

		this.cache = new src$1({
			uri: typeof cacheAdapter === 'string' && cacheAdapter,
			store: typeof cacheAdapter !== 'string' && cacheAdapter,
			namespace: 'cacheable-request'
		});

		return this.createCacheableRequest(request);
	}

	createCacheableRequest(request) {
		return (opts, cb) => {
			let url;
			if (typeof opts === 'string') {
				url = normalizeUrlObject(url_1__default["default"].parse(opts));
				opts = {};
			} else if (opts instanceof url_1__default["default"].URL) {
				url = normalizeUrlObject(url_1__default["default"].parse(opts.toString()));
				opts = {};
			} else {
				const [pathname, ...searchParts] = (opts.path || '').split('?');
				const search = searchParts.length > 0 ?
					`?${searchParts.join('?')}` :
					'';
				url = normalizeUrlObject({ ...opts, pathname, search });
			}

			opts = {
				headers: {},
				method: 'GET',
				cache: true,
				strictTtl: false,
				automaticFailover: false,
				...opts,
				...urlObjectToRequestOptions(url)
			};
			opts.headers = lowercaseKeys(opts.headers);

			const ee = new EventEmitter__default["default"]();
			const normalizedUrlString = normalizeUrl_1(
				url_1__default["default"].format(url),
				{
					stripWWW: false,
					removeTrailingSlash: false,
					stripAuthentication: false
				}
			);
			const key = `${opts.method}:${normalizedUrlString}`;
			let revalidate = false;
			let madeRequest = false;

			const makeRequest = opts => {
				madeRequest = true;
				let requestErrored = false;
				let requestErrorCallback;

				const requestErrorPromise = new Promise(resolve => {
					requestErrorCallback = () => {
						if (!requestErrored) {
							requestErrored = true;
							resolve();
						}
					};
				});

				const handler = response => {
					if (revalidate && !opts.forceRefresh) {
						response.status = response.statusCode;
						const revalidatedPolicy = httpCacheSemantics.fromObject(revalidate.cachePolicy).revalidatedPolicy(opts, response);
						if (!revalidatedPolicy.modified) {
							const headers = revalidatedPolicy.policy.responseHeaders();
							response = new src$3(revalidate.statusCode, headers, revalidate.body, revalidate.url);
							response.cachePolicy = revalidatedPolicy.policy;
							response.fromCache = true;
						}
					}

					if (!response.fromCache) {
						response.cachePolicy = new httpCacheSemantics(opts, response, opts);
						response.fromCache = false;
					}

					let clonedResponse;
					if (opts.cache && response.cachePolicy.storable()) {
						clonedResponse = src$2(response);

						(async () => {
							try {
								const bodyPromise = getStream_1.buffer(response);

								await Promise.race([
									requestErrorPromise,
									new Promise(resolve => response.once('end', resolve))
								]);

								if (requestErrored) {
									return;
								}

								const body = await bodyPromise;

								const value = {
									cachePolicy: response.cachePolicy.toObject(),
									url: response.url,
									statusCode: response.fromCache ? revalidate.statusCode : response.statusCode,
									body
								};

								let ttl = opts.strictTtl ? response.cachePolicy.timeToLive() : undefined;
								if (opts.maxTtl) {
									ttl = ttl ? Math.min(ttl, opts.maxTtl) : opts.maxTtl;
								}

								await this.cache.set(key, value, ttl);
							} catch (error) {
								ee.emit('error', new CacheableRequest.CacheError(error));
							}
						})();
					} else if (opts.cache && revalidate) {
						(async () => {
							try {
								await this.cache.delete(key);
							} catch (error) {
								ee.emit('error', new CacheableRequest.CacheError(error));
							}
						})();
					}

					ee.emit('response', clonedResponse || response);
					if (typeof cb === 'function') {
						cb(clonedResponse || response);
					}
				};

				try {
					const req = request(opts, handler);
					req.once('error', requestErrorCallback);
					req.once('abort', requestErrorCallback);
					ee.emit('request', req);
				} catch (error) {
					ee.emit('error', new CacheableRequest.RequestError(error));
				}
			};

			(async () => {
				const get = async opts => {
					await Promise.resolve();

					const cacheEntry = opts.cache ? await this.cache.get(key) : undefined;
					if (typeof cacheEntry === 'undefined') {
						return makeRequest(opts);
					}

					const policy = httpCacheSemantics.fromObject(cacheEntry.cachePolicy);
					if (policy.satisfiesWithoutRevalidation(opts) && !opts.forceRefresh) {
						const headers = policy.responseHeaders();
						const response = new src$3(cacheEntry.statusCode, headers, cacheEntry.body, cacheEntry.url);
						response.cachePolicy = policy;
						response.fromCache = true;

						ee.emit('response', response);
						if (typeof cb === 'function') {
							cb(response);
						}
					} else {
						revalidate = cacheEntry;
						opts.headers = policy.revalidationHeaders(opts);
						makeRequest(opts);
					}
				};

				const errorHandler = error => ee.emit('error', new CacheableRequest.CacheError(error));
				this.cache.once('error', errorHandler);
				ee.on('response', () => this.cache.removeListener('error', errorHandler));

				try {
					await get(opts);
				} catch (error) {
					if (opts.automaticFailover && !madeRequest) {
						makeRequest(opts);
					}

					ee.emit('error', new CacheableRequest.CacheError(error));
				}
			})();

			return ee;
		};
	}
}

function urlObjectToRequestOptions(url) {
	const options = { ...url };
	options.path = `${url.pathname || '/'}${url.search || ''}`;
	delete options.pathname;
	delete options.search;
	return options;
}

function normalizeUrlObject(url) {
	// If url was parsed by url.parse or new URL:
	// - hostname will be set
	// - host will be hostname[:port]
	// - port will be set if it was explicit in the parsed string
	// Otherwise, url was from request options:
	// - hostname or host may be set
	// - host shall not have port encoded
	return {
		protocol: url.protocol,
		auth: url.auth,
		hostname: url.hostname || url.host || 'localhost',
		port: url.port,
		pathname: url.pathname,
		search: url.search
	};
}

CacheableRequest.RequestError = class extends Error {
	constructor(error) {
		super(error.message);
		this.name = 'RequestError';
		Object.assign(this, error);
	}
};

CacheableRequest.CacheError = class extends Error {
	constructor(error) {
		super(error.message);
		this.name = 'CacheError';
		Object.assign(this, error);
	}
};

var src = CacheableRequest;

// We define these manually to ensure they're always copied
// even if they would move up the prototype chain
// https://nodejs.org/api/http.html#http_class_http_incomingmessage
const knownProperties = [
	'aborted',
	'complete',
	'headers',
	'httpVersion',
	'httpVersionMinor',
	'httpVersionMajor',
	'method',
	'rawHeaders',
	'rawTrailers',
	'setTimeout',
	'socket',
	'statusCode',
	'statusMessage',
	'trailers',
	'url'
];

var mimicResponse = (fromStream, toStream) => {
	if (toStream._readableState.autoDestroy) {
		throw new Error('The second stream must have the `autoDestroy` option set to `false`');
	}

	const fromProperties = new Set(Object.keys(fromStream).concat(knownProperties));

	const properties = {};

	for (const property of fromProperties) {
		// Don't overwrite existing properties.
		if (property in toStream) {
			continue;
		}

		properties[property] = {
			get() {
				const value = fromStream[property];
				const isFunction = typeof value === 'function';

				return isFunction ? value.bind(fromStream) : value;
			},
			set(value) {
				fromStream[property] = value;
			},
			enumerable: true,
			configurable: false
		};
	}

	Object.defineProperties(toStream, properties);

	fromStream.once('aborted', () => {
		toStream.destroy();

		toStream.emit('aborted');
	});

	fromStream.once('close', () => {
		if (fromStream.complete) {
			if (toStream.readable) {
				toStream.once('end', () => {
					toStream.emit('close');
				});
			} else {
				toStream.emit('close');
			}
		} else {
			toStream.emit('close');
		}
	});

	return toStream;
};

const {Transform, PassThrough} = require$$0__default$2["default"];



var decompressResponse = response => {
	const contentEncoding = (response.headers['content-encoding'] || '').toLowerCase();

	if (!['gzip', 'deflate', 'br'].includes(contentEncoding)) {
		return response;
	}

	// TODO: Remove this when targeting Node.js 12.
	const isBrotli = contentEncoding === 'br';
	if (isBrotli && typeof zlib__default["default"].createBrotliDecompress !== 'function') {
		response.destroy(new Error('Brotli is not supported on Node.js < 12'));
		return response;
	}

	let isEmpty = true;

	const checker = new Transform({
		transform(data, _encoding, callback) {
			isEmpty = false;

			callback(null, data);
		},

		flush(callback) {
			callback();
		}
	});

	const finalStream = new PassThrough({
		autoDestroy: false,
		destroy(error, callback) {
			response.destroy();

			callback(error);
		}
	});

	const decompressStream = isBrotli ? zlib__default["default"].createBrotliDecompress() : zlib__default["default"].createUnzip();

	decompressStream.once('error', error => {
		if (isEmpty && !response.readable) {
			finalStream.end();
			return;
		}

		finalStream.destroy(error);
	});

	mimicResponse(response, finalStream);
	response.pipe(checker).pipe(decompressStream).pipe(finalStream);

	return finalStream;
};

class QuickLRU {
	constructor(options = {}) {
		if (!(options.maxSize && options.maxSize > 0)) {
			throw new TypeError('`maxSize` must be a number greater than 0');
		}

		this.maxSize = options.maxSize;
		this.onEviction = options.onEviction;
		this.cache = new Map();
		this.oldCache = new Map();
		this._size = 0;
	}

	_set(key, value) {
		this.cache.set(key, value);
		this._size++;

		if (this._size >= this.maxSize) {
			this._size = 0;

			if (typeof this.onEviction === 'function') {
				for (const [key, value] of this.oldCache.entries()) {
					this.onEviction(key, value);
				}
			}

			this.oldCache = this.cache;
			this.cache = new Map();
		}
	}

	get(key) {
		if (this.cache.has(key)) {
			return this.cache.get(key);
		}

		if (this.oldCache.has(key)) {
			const value = this.oldCache.get(key);
			this.oldCache.delete(key);
			this._set(key, value);
			return value;
		}
	}

	set(key, value) {
		if (this.cache.has(key)) {
			this.cache.set(key, value);
		} else {
			this._set(key, value);
		}

		return this;
	}

	has(key) {
		return this.cache.has(key) || this.oldCache.has(key);
	}

	peek(key) {
		if (this.cache.has(key)) {
			return this.cache.get(key);
		}

		if (this.oldCache.has(key)) {
			return this.oldCache.get(key);
		}
	}

	delete(key) {
		const deleted = this.cache.delete(key);
		if (deleted) {
			this._size--;
		}

		return this.oldCache.delete(key) || deleted;
	}

	clear() {
		this.cache.clear();
		this.oldCache.clear();
		this._size = 0;
	}

	* keys() {
		for (const [key] of this) {
			yield key;
		}
	}

	* values() {
		for (const [, value] of this) {
			yield value;
		}
	}

	* [Symbol.iterator]() {
		for (const item of this.cache) {
			yield item;
		}

		for (const item of this.oldCache) {
			const [key] = item;
			if (!this.cache.has(key)) {
				yield item;
			}
		}
	}

	get size() {
		let oldCacheSize = 0;
		for (const key of this.oldCache.keys()) {
			if (!this.cache.has(key)) {
				oldCacheSize++;
			}
		}

		return Math.min(this._size + oldCacheSize, this.maxSize);
	}
}

var quickLru = QuickLRU;

const kCurrentStreamsCount = Symbol('currentStreamsCount');
const kRequest = Symbol('request');
const kOriginSet = Symbol('cachedOriginSet');
const kGracefullyClosing = Symbol('gracefullyClosing');

const nameKeys = [
	// `http2.connect()` options
	'maxDeflateDynamicTableSize',
	'maxSessionMemory',
	'maxHeaderListPairs',
	'maxOutstandingPings',
	'maxReservedRemoteStreams',
	'maxSendHeaderBlockLength',
	'paddingStrategy',

	// `tls.connect()` options
	'localAddress',
	'path',
	'rejectUnauthorized',
	'minDHSize',

	// `tls.createSecureContext()` options
	'ca',
	'cert',
	'clientCertEngine',
	'ciphers',
	'key',
	'pfx',
	'servername',
	'minVersion',
	'maxVersion',
	'secureProtocol',
	'crl',
	'honorCipherOrder',
	'ecdhCurve',
	'dhparam',
	'secureOptions',
	'sessionIdContext'
];

const getSortedIndex = (array, value, compare) => {
	let low = 0;
	let high = array.length;

	while (low < high) {
		const mid = (low + high) >>> 1;

		/* istanbul ignore next */
		if (compare(array[mid], value)) {
			// This never gets called because we use descending sort. Better to have this anyway.
			low = mid + 1;
		} else {
			high = mid;
		}
	}

	return low;
};

const compareSessions = (a, b) => {
	return a.remoteSettings.maxConcurrentStreams > b.remoteSettings.maxConcurrentStreams;
};

// See https://tools.ietf.org/html/rfc8336
const closeCoveredSessions = (where, session) => {
	// Clients SHOULD NOT emit new requests on any connection whose Origin
	// Set is a proper subset of another connection's Origin Set, and they
	// SHOULD close it once all outstanding requests are satisfied.
	for (const coveredSession of where) {
		if (
			// The set is a proper subset when its length is less than the other set.
			coveredSession[kOriginSet].length < session[kOriginSet].length &&

			// And the other set includes all elements of the subset.
			coveredSession[kOriginSet].every(origin => session[kOriginSet].includes(origin)) &&

			// Makes sure that the session can handle all requests from the covered session.
			coveredSession[kCurrentStreamsCount] + session[kCurrentStreamsCount] <= session.remoteSettings.maxConcurrentStreams
		) {
			// This allows pending requests to finish and prevents making new requests.
			gracefullyClose(coveredSession);
		}
	}
};

// This is basically inverted `closeCoveredSessions(...)`.
const closeSessionIfCovered = (where, coveredSession) => {
	for (const session of where) {
		if (
			coveredSession[kOriginSet].length < session[kOriginSet].length &&
			coveredSession[kOriginSet].every(origin => session[kOriginSet].includes(origin)) &&
			coveredSession[kCurrentStreamsCount] + session[kCurrentStreamsCount] <= session.remoteSettings.maxConcurrentStreams
		) {
			gracefullyClose(coveredSession);
		}
	}
};

const getSessions = ({agent, isFree}) => {
	const result = {};

	// eslint-disable-next-line guard-for-in
	for (const normalizedOptions in agent.sessions) {
		const sessions = agent.sessions[normalizedOptions];

		const filtered = sessions.filter(session => {
			const result = session[Agent$1.kCurrentStreamsCount] < session.remoteSettings.maxConcurrentStreams;

			return isFree ? result : !result;
		});

		if (filtered.length !== 0) {
			result[normalizedOptions] = filtered;
		}
	}

	return result;
};

const gracefullyClose = session => {
	session[kGracefullyClosing] = true;

	if (session[kCurrentStreamsCount] === 0) {
		session.close();
	}
};

class Agent$1 extends EventEmitter__default["default"] {
	constructor({timeout = 60000, maxSessions = Infinity, maxFreeSessions = 10, maxCachedTlsSessions = 100} = {}) {
		super();

		// A session is considered busy when its current streams count
		// is equal to or greater than the `maxConcurrentStreams` value.

		// A session is considered free when its current streams count
		// is less than the `maxConcurrentStreams` value.

		// SESSIONS[NORMALIZED_OPTIONS] = [];
		this.sessions = {};

		// The queue for creating new sessions. It looks like this:
		// QUEUE[NORMALIZED_OPTIONS][NORMALIZED_ORIGIN] = ENTRY_FUNCTION
		//
		// The entry function has `listeners`, `completed` and `destroyed` properties.
		// `listeners` is an array of objects containing `resolve` and `reject` functions.
		// `completed` is a boolean. It's set to true after ENTRY_FUNCTION is executed.
		// `destroyed` is a boolean. If it's set to true, the session will be destroyed if hasn't connected yet.
		this.queue = {};

		// Each session will use this timeout value.
		this.timeout = timeout;

		// Max sessions in total
		this.maxSessions = maxSessions;

		// Max free sessions in total
		// TODO: decreasing `maxFreeSessions` should close some sessions
		this.maxFreeSessions = maxFreeSessions;

		this._freeSessionsCount = 0;
		this._sessionsCount = 0;

		// We don't support push streams by default.
		this.settings = {
			enablePush: false
		};

		// Reusing TLS sessions increases performance.
		this.tlsSessionCache = new quickLru({maxSize: maxCachedTlsSessions});
	}

	static normalizeOrigin(url, servername) {
		if (typeof url === 'string') {
			url = new URL(url);
		}

		if (servername && url.hostname !== servername) {
			url.hostname = servername;
		}

		return url.origin;
	}

	normalizeOptions(options) {
		let normalized = '';

		if (options) {
			for (const key of nameKeys) {
				if (options[key]) {
					normalized += `:${options[key]}`;
				}
			}
		}

		return normalized;
	}

	_tryToCreateNewSession(normalizedOptions, normalizedOrigin) {
		if (!(normalizedOptions in this.queue) || !(normalizedOrigin in this.queue[normalizedOptions])) {
			return;
		}

		const item = this.queue[normalizedOptions][normalizedOrigin];

		// The entry function can be run only once.
		// BUG: The session may be never created when:
		// - the first condition is false AND
		// - this function is never called with the same arguments in the future.
		if (this._sessionsCount < this.maxSessions && !item.completed) {
			item.completed = true;

			item();
		}
	}

	getSession(origin, options, listeners) {
		return new Promise((resolve, reject) => {
			if (Array.isArray(listeners)) {
				listeners = [...listeners];

				// Resolve the current promise ASAP, we're just moving the listeners.
				// They will be executed at a different time.
				resolve();
			} else {
				listeners = [{resolve, reject}];
			}

			const normalizedOptions = this.normalizeOptions(options);
			const normalizedOrigin = Agent$1.normalizeOrigin(origin, options && options.servername);

			if (normalizedOrigin === undefined) {
				for (const {reject} of listeners) {
					reject(new TypeError('The `origin` argument needs to be a string or an URL object'));
				}

				return;
			}

			if (normalizedOptions in this.sessions) {
				const sessions = this.sessions[normalizedOptions];

				let maxConcurrentStreams = -1;
				let currentStreamsCount = -1;
				let optimalSession;

				// We could just do this.sessions[normalizedOptions].find(...) but that isn't optimal.
				// Additionally, we are looking for session which has biggest current pending streams count.
				for (const session of sessions) {
					const sessionMaxConcurrentStreams = session.remoteSettings.maxConcurrentStreams;

					if (sessionMaxConcurrentStreams < maxConcurrentStreams) {
						break;
					}

					if (session[kOriginSet].includes(normalizedOrigin)) {
						const sessionCurrentStreamsCount = session[kCurrentStreamsCount];

						if (
							sessionCurrentStreamsCount >= sessionMaxConcurrentStreams ||
							session[kGracefullyClosing] ||
							// Unfortunately the `close` event isn't called immediately,
							// so `session.destroyed` is `true`, but `session.closed` is `false`.
							session.destroyed
						) {
							continue;
						}

						// We only need set this once.
						if (!optimalSession) {
							maxConcurrentStreams = sessionMaxConcurrentStreams;
						}

						// We're looking for the session which has biggest current pending stream count,
						// in order to minimalize the amount of active sessions.
						if (sessionCurrentStreamsCount > currentStreamsCount) {
							optimalSession = session;
							currentStreamsCount = sessionCurrentStreamsCount;
						}
					}
				}

				if (optimalSession) {
					/* istanbul ignore next: safety check */
					if (listeners.length !== 1) {
						for (const {reject} of listeners) {
							const error = new Error(
								`Expected the length of listeners to be 1, got ${listeners.length}.\n` +
								'Please report this to https://github.com/szmarczak/http2-wrapper/'
							);

							reject(error);
						}

						return;
					}

					listeners[0].resolve(optimalSession);
					return;
				}
			}

			if (normalizedOptions in this.queue) {
				if (normalizedOrigin in this.queue[normalizedOptions]) {
					// There's already an item in the queue, just attach ourselves to it.
					this.queue[normalizedOptions][normalizedOrigin].listeners.push(...listeners);

					// This shouldn't be executed here.
					// See the comment inside _tryToCreateNewSession.
					this._tryToCreateNewSession(normalizedOptions, normalizedOrigin);
					return;
				}
			} else {
				this.queue[normalizedOptions] = {};
			}

			// The entry must be removed from the queue IMMEDIATELY when:
			// 1. the session connects successfully,
			// 2. an error occurs.
			const removeFromQueue = () => {
				// Our entry can be replaced. We cannot remove the new one.
				if (normalizedOptions in this.queue && this.queue[normalizedOptions][normalizedOrigin] === entry) {
					delete this.queue[normalizedOptions][normalizedOrigin];

					if (Object.keys(this.queue[normalizedOptions]).length === 0) {
						delete this.queue[normalizedOptions];
					}
				}
			};

			// The main logic is here
			const entry = () => {
				const name = `${normalizedOrigin}:${normalizedOptions}`;
				let receivedSettings = false;

				try {
					const session = http2__default["default"].connect(origin, {
						createConnection: this.createConnection,
						settings: this.settings,
						session: this.tlsSessionCache.get(name),
						...options
					});
					session[kCurrentStreamsCount] = 0;
					session[kGracefullyClosing] = false;

					const isFree = () => session[kCurrentStreamsCount] < session.remoteSettings.maxConcurrentStreams;
					let wasFree = true;

					session.socket.once('session', tlsSession => {
						this.tlsSessionCache.set(name, tlsSession);
					});

					session.once('error', error => {
						// Listeners are empty when the session successfully connected.
						for (const {reject} of listeners) {
							reject(error);
						}

						// The connection got broken, purge the cache.
						this.tlsSessionCache.delete(name);
					});

					session.setTimeout(this.timeout, () => {
						// Terminates all streams owned by this session.
						// TODO: Maybe the streams should have a "Session timed out" error?
						session.destroy();
					});

					session.once('close', () => {
						if (receivedSettings) {
							// 1. If it wasn't free then no need to decrease because
							//    it has been decreased already in session.request().
							// 2. `stream.once('close')` won't increment the count
							//    because the session is already closed.
							if (wasFree) {
								this._freeSessionsCount--;
							}

							this._sessionsCount--;

							// This cannot be moved to the stream logic,
							// because there may be a session that hadn't made a single request.
							const where = this.sessions[normalizedOptions];
							where.splice(where.indexOf(session), 1);

							if (where.length === 0) {
								delete this.sessions[normalizedOptions];
							}
						} else {
							// Broken connection
							const error = new Error('Session closed without receiving a SETTINGS frame');
							error.code = 'HTTP2WRAPPER_NOSETTINGS';

							for (const {reject} of listeners) {
								reject(error);
							}

							removeFromQueue();
						}

						// There may be another session awaiting.
						this._tryToCreateNewSession(normalizedOptions, normalizedOrigin);
					});

					// Iterates over the queue and processes listeners.
					const processListeners = () => {
						if (!(normalizedOptions in this.queue) || !isFree()) {
							return;
						}

						for (const origin of session[kOriginSet]) {
							if (origin in this.queue[normalizedOptions]) {
								const {listeners} = this.queue[normalizedOptions][origin];

								// Prevents session overloading.
								while (listeners.length !== 0 && isFree()) {
									// We assume `resolve(...)` calls `request(...)` *directly*,
									// otherwise the session will get overloaded.
									listeners.shift().resolve(session);
								}

								const where = this.queue[normalizedOptions];
								if (where[origin].listeners.length === 0) {
									delete where[origin];

									if (Object.keys(where).length === 0) {
										delete this.queue[normalizedOptions];
										break;
									}
								}

								// We're no longer free, no point in continuing.
								if (!isFree()) {
									break;
								}
							}
						}
					};

					// The Origin Set cannot shrink. No need to check if it suddenly became covered by another one.
					session.on('origin', () => {
						session[kOriginSet] = session.originSet;

						if (!isFree()) {
							// The session is full.
							return;
						}

						processListeners();

						// Close covered sessions (if possible).
						closeCoveredSessions(this.sessions[normalizedOptions], session);
					});

					session.once('remoteSettings', () => {
						// Fix Node.js bug preventing the process from exiting
						session.ref();
						session.unref();

						this._sessionsCount++;

						// The Agent could have been destroyed already.
						if (entry.destroyed) {
							const error = new Error('Agent has been destroyed');

							for (const listener of listeners) {
								listener.reject(error);
							}

							session.destroy();
							return;
						}

						session[kOriginSet] = session.originSet;

						{
							const where = this.sessions;

							if (normalizedOptions in where) {
								const sessions = where[normalizedOptions];
								sessions.splice(getSortedIndex(sessions, session, compareSessions), 0, session);
							} else {
								where[normalizedOptions] = [session];
							}
						}

						this._freeSessionsCount += 1;
						receivedSettings = true;

						this.emit('session', session);

						processListeners();
						removeFromQueue();

						// TODO: Close last recently used (or least used?) session
						if (session[kCurrentStreamsCount] === 0 && this._freeSessionsCount > this.maxFreeSessions) {
							session.close();
						}

						// Check if we haven't managed to execute all listeners.
						if (listeners.length !== 0) {
							// Request for a new session with predefined listeners.
							this.getSession(normalizedOrigin, options, listeners);
							listeners.length = 0;
						}

						// `session.remoteSettings.maxConcurrentStreams` might get increased
						session.on('remoteSettings', () => {
							processListeners();

							// In case the Origin Set changes
							closeCoveredSessions(this.sessions[normalizedOptions], session);
						});
					});

					// Shim `session.request()` in order to catch all streams
					session[kRequest] = session.request;
					session.request = (headers, streamOptions) => {
						if (session[kGracefullyClosing]) {
							throw new Error('The session is gracefully closing. No new streams are allowed.');
						}

						const stream = session[kRequest](headers, streamOptions);

						// The process won't exit until the session is closed or all requests are gone.
						session.ref();

						++session[kCurrentStreamsCount];

						if (session[kCurrentStreamsCount] === session.remoteSettings.maxConcurrentStreams) {
							this._freeSessionsCount--;
						}

						stream.once('close', () => {
							wasFree = isFree();

							--session[kCurrentStreamsCount];

							if (!session.destroyed && !session.closed) {
								closeSessionIfCovered(this.sessions[normalizedOptions], session);

								if (isFree() && !session.closed) {
									if (!wasFree) {
										this._freeSessionsCount++;

										wasFree = true;
									}

									const isEmpty = session[kCurrentStreamsCount] === 0;

									if (isEmpty) {
										session.unref();
									}

									if (
										isEmpty &&
										(
											this._freeSessionsCount > this.maxFreeSessions ||
											session[kGracefullyClosing]
										)
									) {
										session.close();
									} else {
										closeCoveredSessions(this.sessions[normalizedOptions], session);
										processListeners();
									}
								}
							}
						});

						return stream;
					};
				} catch (error) {
					for (const listener of listeners) {
						listener.reject(error);
					}

					removeFromQueue();
				}
			};

			entry.listeners = listeners;
			entry.completed = false;
			entry.destroyed = false;

			this.queue[normalizedOptions][normalizedOrigin] = entry;
			this._tryToCreateNewSession(normalizedOptions, normalizedOrigin);
		});
	}

	request(origin, options, headers, streamOptions) {
		return new Promise((resolve, reject) => {
			this.getSession(origin, options, [{
				reject,
				resolve: session => {
					try {
						resolve(session.request(headers, streamOptions));
					} catch (error) {
						reject(error);
					}
				}
			}]);
		});
	}

	createConnection(origin, options) {
		return Agent$1.connect(origin, options);
	}

	static connect(origin, options) {
		options.ALPNProtocols = ['h2'];

		const port = origin.port || 443;
		const host = origin.hostname || origin.host;

		if (typeof options.servername === 'undefined') {
			options.servername = host;
		}

		return tls__default["default"].connect(port, host, options);
	}

	closeFreeSessions() {
		for (const sessions of Object.values(this.sessions)) {
			for (const session of sessions) {
				if (session[kCurrentStreamsCount] === 0) {
					session.close();
				}
			}
		}
	}

	destroy(reason) {
		for (const sessions of Object.values(this.sessions)) {
			for (const session of sessions) {
				session.destroy(reason);
			}
		}

		for (const entriesOfAuthority of Object.values(this.queue)) {
			for (const entry of Object.values(entriesOfAuthority)) {
				entry.destroyed = true;
			}
		}

		// New requests should NOT attach to destroyed sessions
		this.queue = {};
	}

	get freeSessions() {
		return getSessions({agent: this, isFree: true});
	}

	get busySessions() {
		return getSessions({agent: this, isFree: false});
	}
}

Agent$1.kCurrentStreamsCount = kCurrentStreamsCount;
Agent$1.kGracefullyClosing = kGracefullyClosing;

var agent = {
	Agent: Agent$1,
	globalAgent: new Agent$1()
};

const {Readable} = require$$0__default$2["default"];

class IncomingMessage extends Readable {
	constructor(socket, highWaterMark) {
		super({
			highWaterMark,
			autoDestroy: false
		});

		this.statusCode = null;
		this.statusMessage = '';
		this.httpVersion = '2.0';
		this.httpVersionMajor = 2;
		this.httpVersionMinor = 0;
		this.headers = {};
		this.trailers = {};
		this.req = null;

		this.aborted = false;
		this.complete = false;
		this.upgrade = null;

		this.rawHeaders = [];
		this.rawTrailers = [];

		this.socket = socket;
		this.connection = socket;

		this._dumped = false;
	}

	_destroy(error) {
		this.req._request.destroy(error);
	}

	setTimeout(ms, callback) {
		this.req.setTimeout(ms, callback);
		return this;
	}

	_dump() {
		if (!this._dumped) {
			this._dumped = true;

			this.removeAllListeners('data');
			this.resume();
		}
	}

	_read() {
		if (this.req) {
			this.req._request.resume();
		}
	}
}

var incomingMessage = IncomingMessage;

/* istanbul ignore file: https://github.com/nodejs/node/blob/a91293d4d9ab403046ab5eb022332e4e3d249bd3/lib/internal/url.js#L1257 */

var urlToOptions$1 = url => {
	const options = {
		protocol: url.protocol,
		hostname: typeof url.hostname === 'string' && url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname,
		host: url.host,
		hash: url.hash,
		search: url.search,
		pathname: url.pathname,
		href: url.href,
		path: `${url.pathname || ''}${url.search || ''}`
	};

	if (typeof url.port === 'string' && url.port.length !== 0) {
		options.port = Number(url.port);
	}

	if (url.username || url.password) {
		options.auth = `${url.username || ''}:${url.password || ''}`;
	}

	return options;
};

var proxyEvents$1 = (from, to, events) => {
	for (const event of events) {
		from.on(event, (...args) => to.emit(event, ...args));
	}
};

var isRequestPseudoHeader = header => {
	switch (header) {
		case ':method':
		case ':scheme':
		case ':authority':
		case ':path':
			return true;
		default:
			return false;
	}
};

var errors = createCommonjsModule(function (module) {
/* istanbul ignore file: https://github.com/nodejs/node/blob/master/lib/internal/errors.js */

const makeError = (Base, key, getMessage) => {
	module.exports[key] = class NodeError extends Base {
		constructor(...args) {
			super(typeof getMessage === 'string' ? getMessage : getMessage(args));
			this.name = `${super.name} [${key}]`;
			this.code = key;
		}
	};
};

makeError(TypeError, 'ERR_INVALID_ARG_TYPE', args => {
	const type = args[0].includes('.') ? 'property' : 'argument';

	let valid = args[1];
	const isManyTypes = Array.isArray(valid);

	if (isManyTypes) {
		valid = `${valid.slice(0, -1).join(', ')} or ${valid.slice(-1)}`;
	}

	return `The "${args[0]}" ${type} must be ${isManyTypes ? 'one of' : 'of'} type ${valid}. Received ${typeof args[2]}`;
});

makeError(TypeError, 'ERR_INVALID_PROTOCOL', args => {
	return `Protocol "${args[0]}" not supported. Expected "${args[1]}"`;
});

makeError(Error, 'ERR_HTTP_HEADERS_SENT', args => {
	return `Cannot ${args[0]} headers after they are sent to the client`;
});

makeError(TypeError, 'ERR_INVALID_HTTP_TOKEN', args => {
	return `${args[0]} must be a valid HTTP token [${args[1]}]`;
});

makeError(TypeError, 'ERR_HTTP_INVALID_HEADER_VALUE', args => {
	return `Invalid value "${args[0]} for header "${args[1]}"`;
});

makeError(TypeError, 'ERR_INVALID_CHAR', args => {
	return `Invalid character in ${args[0]} [${args[1]}]`;
});
});

const {Writable} = require$$0__default$2["default"];
const {Agent, globalAgent} = agent;




const {
	ERR_INVALID_ARG_TYPE,
	ERR_INVALID_PROTOCOL,
	ERR_HTTP_HEADERS_SENT,
	ERR_INVALID_HTTP_TOKEN,
	ERR_HTTP_INVALID_HEADER_VALUE,
	ERR_INVALID_CHAR
} = errors;

const {
	HTTP2_HEADER_STATUS,
	HTTP2_HEADER_METHOD,
	HTTP2_HEADER_PATH,
	HTTP2_METHOD_CONNECT
} = http2__default["default"].constants;

const kHeaders = Symbol('headers');
const kOrigin = Symbol('origin');
const kSession = Symbol('session');
const kOptions = Symbol('options');
const kFlushedHeaders = Symbol('flushedHeaders');
const kJobs = Symbol('jobs');

const isValidHttpToken = /^[\^`\-\w!#$%&*+.|~]+$/;
const isInvalidHeaderValue = /[^\t\u0020-\u007E\u0080-\u00FF]/;

class ClientRequest extends Writable {
	constructor(input, options, callback) {
		super({
			autoDestroy: false
		});

		const hasInput = typeof input === 'string' || input instanceof URL;
		if (hasInput) {
			input = urlToOptions$1(input instanceof URL ? input : new URL(input));
		}

		if (typeof options === 'function' || options === undefined) {
			// (options, callback)
			callback = options;
			options = hasInput ? input : {...input};
		} else {
			// (input, options, callback)
			options = {...input, ...options};
		}

		if (options.h2session) {
			this[kSession] = options.h2session;
		} else if (options.agent === false) {
			this.agent = new Agent({maxFreeSessions: 0});
		} else if (typeof options.agent === 'undefined' || options.agent === null) {
			if (typeof options.createConnection === 'function') {
				// This is a workaround - we don't have to create the session on our own.
				this.agent = new Agent({maxFreeSessions: 0});
				this.agent.createConnection = options.createConnection;
			} else {
				this.agent = globalAgent;
			}
		} else if (typeof options.agent.request === 'function') {
			this.agent = options.agent;
		} else {
			throw new ERR_INVALID_ARG_TYPE('options.agent', ['Agent-like Object', 'undefined', 'false'], options.agent);
		}

		if (options.protocol && options.protocol !== 'https:') {
			throw new ERR_INVALID_PROTOCOL(options.protocol, 'https:');
		}

		const port = options.port || options.defaultPort || (this.agent && this.agent.defaultPort) || 443;
		const host = options.hostname || options.host || 'localhost';

		// Don't enforce the origin via options. It may be changed in an Agent.
		delete options.hostname;
		delete options.host;
		delete options.port;

		const {timeout} = options;
		options.timeout = undefined;

		this[kHeaders] = Object.create(null);
		this[kJobs] = [];

		this.socket = null;
		this.connection = null;

		this.method = options.method || 'GET';
		this.path = options.path;

		this.res = null;
		this.aborted = false;
		this.reusedSocket = false;

		if (options.headers) {
			for (const [header, value] of Object.entries(options.headers)) {
				this.setHeader(header, value);
			}
		}

		if (options.auth && !('authorization' in this[kHeaders])) {
			this[kHeaders].authorization = 'Basic ' + Buffer.from(options.auth).toString('base64');
		}

		options.session = options.tlsSession;
		options.path = options.socketPath;

		this[kOptions] = options;

		// Clients that generate HTTP/2 requests directly SHOULD use the :authority pseudo-header field instead of the Host header field.
		if (port === 443) {
			this[kOrigin] = `https://${host}`;

			if (!(':authority' in this[kHeaders])) {
				this[kHeaders][':authority'] = host;
			}
		} else {
			this[kOrigin] = `https://${host}:${port}`;

			if (!(':authority' in this[kHeaders])) {
				this[kHeaders][':authority'] = `${host}:${port}`;
			}
		}

		if (timeout) {
			this.setTimeout(timeout);
		}

		if (callback) {
			this.once('response', callback);
		}

		this[kFlushedHeaders] = false;
	}

	get method() {
		return this[kHeaders][HTTP2_HEADER_METHOD];
	}

	set method(value) {
		if (value) {
			this[kHeaders][HTTP2_HEADER_METHOD] = value.toUpperCase();
		}
	}

	get path() {
		return this[kHeaders][HTTP2_HEADER_PATH];
	}

	set path(value) {
		if (value) {
			this[kHeaders][HTTP2_HEADER_PATH] = value;
		}
	}

	get _mustNotHaveABody() {
		return this.method === 'GET' || this.method === 'HEAD' || this.method === 'DELETE';
	}

	_write(chunk, encoding, callback) {
		// https://github.com/nodejs/node/blob/654df09ae0c5e17d1b52a900a545f0664d8c7627/lib/internal/http2/util.js#L148-L156
		if (this._mustNotHaveABody) {
			callback(new Error('The GET, HEAD and DELETE methods must NOT have a body'));
			/* istanbul ignore next: Node.js 12 throws directly */
			return;
		}

		this.flushHeaders();

		const callWrite = () => this._request.write(chunk, encoding, callback);
		if (this._request) {
			callWrite();
		} else {
			this[kJobs].push(callWrite);
		}
	}

	_final(callback) {
		if (this.destroyed) {
			return;
		}

		this.flushHeaders();

		const callEnd = () => {
			// For GET, HEAD and DELETE
			if (this._mustNotHaveABody) {
				callback();
				return;
			}

			this._request.end(callback);
		};

		if (this._request) {
			callEnd();
		} else {
			this[kJobs].push(callEnd);
		}
	}

	abort() {
		if (this.res && this.res.complete) {
			return;
		}

		if (!this.aborted) {
			process.nextTick(() => this.emit('abort'));
		}

		this.aborted = true;

		this.destroy();
	}

	_destroy(error, callback) {
		if (this.res) {
			this.res._dump();
		}

		if (this._request) {
			this._request.destroy();
		}

		callback(error);
	}

	async flushHeaders() {
		if (this[kFlushedHeaders] || this.destroyed) {
			return;
		}

		this[kFlushedHeaders] = true;

		const isConnectMethod = this.method === HTTP2_METHOD_CONNECT;

		// The real magic is here
		const onStream = stream => {
			this._request = stream;

			if (this.destroyed) {
				stream.destroy();
				return;
			}

			// Forwards `timeout`, `continue`, `close` and `error` events to this instance.
			if (!isConnectMethod) {
				proxyEvents$1(stream, this, ['timeout', 'continue', 'close', 'error']);
			}

			// Wait for the `finish` event. We don't want to emit the `response` event
			// before `request.end()` is called.
			const waitForEnd = fn => {
				return (...args) => {
					if (!this.writable && !this.destroyed) {
						fn(...args);
					} else {
						this.once('finish', () => {
							fn(...args);
						});
					}
				};
			};

			// This event tells we are ready to listen for the data.
			stream.once('response', waitForEnd((headers, flags, rawHeaders) => {
				// If we were to emit raw request stream, it would be as fast as the native approach.
				// Note that wrapping the raw stream in a Proxy instance won't improve the performance (already tested it).
				const response = new incomingMessage(this.socket, stream.readableHighWaterMark);
				this.res = response;

				response.req = this;
				response.statusCode = headers[HTTP2_HEADER_STATUS];
				response.headers = headers;
				response.rawHeaders = rawHeaders;

				response.once('end', () => {
					if (this.aborted) {
						response.aborted = true;
						response.emit('aborted');
					} else {
						response.complete = true;

						// Has no effect, just be consistent with the Node.js behavior
						response.socket = null;
						response.connection = null;
					}
				});

				if (isConnectMethod) {
					response.upgrade = true;

					// The HTTP1 API says the socket is detached here,
					// but we can't do that so we pass the original HTTP2 request.
					if (this.emit('connect', response, stream, Buffer.alloc(0))) {
						this.emit('close');
					} else {
						// No listeners attached, destroy the original request.
						stream.destroy();
					}
				} else {
					// Forwards data
					stream.on('data', chunk => {
						if (!response._dumped && !response.push(chunk)) {
							stream.pause();
						}
					});

					stream.once('end', () => {
						response.push(null);
					});

					if (!this.emit('response', response)) {
						// No listeners attached, dump the response.
						response._dump();
					}
				}
			}));

			// Emits `information` event
			stream.once('headers', waitForEnd(
				headers => this.emit('information', {statusCode: headers[HTTP2_HEADER_STATUS]})
			));

			stream.once('trailers', waitForEnd((trailers, flags, rawTrailers) => {
				const {res} = this;

				// Assigns trailers to the response object.
				res.trailers = trailers;
				res.rawTrailers = rawTrailers;
			}));

			const {socket} = stream.session;
			this.socket = socket;
			this.connection = socket;

			for (const job of this[kJobs]) {
				job();
			}

			this.emit('socket', this.socket);
		};

		// Makes a HTTP2 request
		if (this[kSession]) {
			try {
				onStream(this[kSession].request(this[kHeaders]));
			} catch (error) {
				this.emit('error', error);
			}
		} else {
			this.reusedSocket = true;

			try {
				onStream(await this.agent.request(this[kOrigin], this[kOptions], this[kHeaders]));
			} catch (error) {
				this.emit('error', error);
			}
		}
	}

	getHeader(name) {
		if (typeof name !== 'string') {
			throw new ERR_INVALID_ARG_TYPE('name', 'string', name);
		}

		return this[kHeaders][name.toLowerCase()];
	}

	get headersSent() {
		return this[kFlushedHeaders];
	}

	removeHeader(name) {
		if (typeof name !== 'string') {
			throw new ERR_INVALID_ARG_TYPE('name', 'string', name);
		}

		if (this.headersSent) {
			throw new ERR_HTTP_HEADERS_SENT('remove');
		}

		delete this[kHeaders][name.toLowerCase()];
	}

	setHeader(name, value) {
		if (this.headersSent) {
			throw new ERR_HTTP_HEADERS_SENT('set');
		}

		if (typeof name !== 'string' || (!isValidHttpToken.test(name) && !isRequestPseudoHeader(name))) {
			throw new ERR_INVALID_HTTP_TOKEN('Header name', name);
		}

		if (typeof value === 'undefined') {
			throw new ERR_HTTP_INVALID_HEADER_VALUE(value, name);
		}

		if (isInvalidHeaderValue.test(value)) {
			throw new ERR_INVALID_CHAR('header content', name);
		}

		this[kHeaders][name.toLowerCase()] = value;
	}

	setNoDelay() {
		// HTTP2 sockets cannot be malformed, do nothing.
	}

	setSocketKeepAlive() {
		// HTTP2 sockets cannot be malformed, do nothing.
	}

	setTimeout(ms, callback) {
		const applyTimeout = () => this._request.setTimeout(ms, callback);

		if (this._request) {
			applyTimeout();
		} else {
			this[kJobs].push(applyTimeout);
		}

		return this;
	}

	get maxHeadersCount() {
		if (!this.destroyed && this._request) {
			return this._request.session.localSettings.maxHeaderListSize;
		}

		return undefined;
	}

	set maxHeadersCount(_value) {
		// Updating HTTP2 settings would affect all requests, do nothing.
	}
}

var clientRequest = ClientRequest;

var resolveAlpn = (options = {}, connect = tls__default["default"].connect) => new Promise((resolve, reject) => {
	let timeout = false;

	let socket;

	const callback = async () => {
		await socketPromise;

		socket.off('timeout', onTimeout);
		socket.off('error', reject);

		if (options.resolveSocket) {
			resolve({alpnProtocol: socket.alpnProtocol, socket, timeout});

			if (timeout) {
				await Promise.resolve();
				socket.emit('timeout');
			}
		} else {
			socket.destroy();
			resolve({alpnProtocol: socket.alpnProtocol, timeout});
		}
	};

	const onTimeout = async () => {
		timeout = true;
		callback();
	};

	const socketPromise = (async () => {
		try {
			socket = await connect(options, callback);

			socket.on('error', reject);
			socket.once('timeout', onTimeout);
		} catch (error) {
			reject(error);
		}
	})();
});

/* istanbul ignore file: https://github.com/nodejs/node/blob/v13.0.1/lib/_http_agent.js */

var calculateServerName = options => {
	let servername = options.host;
	const hostHeader = options.headers && options.headers.host;

	if (hostHeader) {
		if (hostHeader.startsWith('[')) {
			const index = hostHeader.indexOf(']');
			if (index === -1) {
				servername = hostHeader;
			} else {
				servername = hostHeader.slice(1, -1);
			}
		} else {
			servername = hostHeader.split(':', 1)[0];
		}
	}

	if (net__default["default"].isIP(servername)) {
		return '';
	}

	return servername;
};

const cache = new quickLru({maxSize: 100});
const queue = new Map();

const installSocket = (agent, socket, options) => {
	socket._httpMessage = {shouldKeepAlive: true};

	const onFree = () => {
		agent.emit('free', socket, options);
	};

	socket.on('free', onFree);

	const onClose = () => {
		agent.removeSocket(socket, options);
	};

	socket.on('close', onClose);

	const onRemove = () => {
		agent.removeSocket(socket, options);
		socket.off('close', onClose);
		socket.off('free', onFree);
		socket.off('agentRemove', onRemove);
	};

	socket.on('agentRemove', onRemove);

	agent.emit('free', socket, options);
};

const resolveProtocol = async options => {
	const name = `${options.host}:${options.port}:${options.ALPNProtocols.sort()}`;

	if (!cache.has(name)) {
		if (queue.has(name)) {
			const result = await queue.get(name);
			return result.alpnProtocol;
		}

		const {path, agent} = options;
		options.path = options.socketPath;

		const resultPromise = resolveAlpn(options);
		queue.set(name, resultPromise);

		try {
			const {socket, alpnProtocol} = await resultPromise;
			cache.set(name, alpnProtocol);

			options.path = path;

			if (alpnProtocol === 'h2') {
				// https://github.com/nodejs/node/issues/33343
				socket.destroy();
			} else {
				const {globalAgent} = https__default["default"];
				const defaultCreateConnection = https__default["default"].Agent.prototype.createConnection;

				if (agent) {
					if (agent.createConnection === defaultCreateConnection) {
						installSocket(agent, socket, options);
					} else {
						socket.destroy();
					}
				} else if (globalAgent.createConnection === defaultCreateConnection) {
					installSocket(globalAgent, socket, options);
				} else {
					socket.destroy();
				}
			}

			queue.delete(name);

			return alpnProtocol;
		} catch (error) {
			queue.delete(name);

			throw error;
		}
	}

	return cache.get(name);
};

var auto = async (input, options, callback) => {
	if (typeof input === 'string' || input instanceof URL) {
		input = urlToOptions$1(new URL(input));
	}

	if (typeof options === 'function') {
		callback = options;
		options = undefined;
	}

	options = {
		ALPNProtocols: ['h2', 'http/1.1'],
		...input,
		...options,
		resolveSocket: true
	};

	if (!Array.isArray(options.ALPNProtocols) || options.ALPNProtocols.length === 0) {
		throw new Error('The `ALPNProtocols` option must be an Array with at least one entry');
	}

	options.protocol = options.protocol || 'https:';
	const isHttps = options.protocol === 'https:';

	options.host = options.hostname || options.host || 'localhost';
	options.session = options.tlsSession;
	options.servername = options.servername || calculateServerName(options);
	options.port = options.port || (isHttps ? 443 : 80);
	options._defaultAgent = isHttps ? https__default["default"].globalAgent : http__default["default"].globalAgent;

	const agents = options.agent;

	if (agents) {
		if (agents.addRequest) {
			throw new Error('The `options.agent` object can contain only `http`, `https` or `http2` properties');
		}

		options.agent = agents[isHttps ? 'https' : 'http'];
	}

	if (isHttps) {
		const protocol = await resolveProtocol(options);

		if (protocol === 'h2') {
			if (agents) {
				options.agent = agents.http2;
			}

			return new clientRequest(options, callback);
		}
	}

	return http__default["default"].request(options, callback);
};

var protocolCache = cache;
auto.protocolCache = protocolCache;

const request = (url, options, callback) => {
	return new clientRequest(url, options, callback);
};

const get = (url, options, callback) => {
	// eslint-disable-next-line unicorn/prevent-abbreviations
	const req = new clientRequest(url, options, callback);
	req.end();

	return req;
};

var source$1 = {
	...http2__default["default"],
	ClientRequest: clientRequest,
	IncomingMessage: incomingMessage,
	...agent,
	request,
	get,
	auto
};

var is_1 = dist;

var isFormData = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });

exports.default = (body) => is_1.default.nodeStream(body) && is_1.default.function_(body.getBoundary);
});

var is_form_data_1 = isFormData;

var getBodySize = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });




const statAsync = util_1__default["default"].promisify(fs__default["default"].stat);
exports.default = async (body, headers) => {
    if (headers && 'content-length' in headers) {
        return Number(headers['content-length']);
    }
    if (!body) {
        return 0;
    }
    if (is_1.default.string(body)) {
        return Buffer.byteLength(body);
    }
    if (is_1.default.buffer(body)) {
        return body.length;
    }
    if (is_form_data_1.default(body)) {
        return util_1__default["default"].promisify(body.getLength.bind(body))();
    }
    if (body instanceof fs__default["default"].ReadStream) {
        const { size } = await statAsync(body.path);
        if (size === 0) {
            return undefined;
        }
        return size;
    }
    return undefined;
};
});

var proxyEvents = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });
function default_1(from, to, events) {
    const fns = {};
    for (const event of events) {
        fns[event] = (...args) => {
            to.emit(event, ...args);
        };
        from.on(event, fns[event]);
    }
    return () => {
        for (const event of events) {
            from.off(event, fns[event]);
        }
    };
}
exports.default = default_1;
});

var unhandle = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });
// When attaching listeners, it's very easy to forget about them.
// Especially if you do error handling and set timeouts.
// So instead of checking if it's proper to throw an error on every timeout ever,
// use this simple tool which will remove all listeners you have attached.
exports.default = () => {
    const handlers = [];
    return {
        once(origin, event, fn) {
            origin.once(event, fn);
            handlers.push({ origin, event, fn });
        },
        unhandleAll() {
            for (const handler of handlers) {
                const { origin, event, fn } = handler;
                origin.removeListener(event, fn);
            }
            handlers.length = 0;
        }
    };
};
});

var unhandle_1 = unhandle;

var timedOut = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeoutError = void 0;


const reentry = Symbol('reentry');
const noop = () => { };
class TimeoutError extends Error {
    constructor(threshold, event) {
        super(`Timeout awaiting '${event}' for ${threshold}ms`);
        this.event = event;
        this.name = 'TimeoutError';
        this.code = 'ETIMEDOUT';
    }
}
exports.TimeoutError = TimeoutError;
exports.default = (request, delays, options) => {
    if (reentry in request) {
        return noop;
    }
    request[reentry] = true;
    const cancelers = [];
    const { once, unhandleAll } = unhandle_1.default();
    const addTimeout = (delay, callback, event) => {
        var _a;
        const timeout = setTimeout(callback, delay, delay, event);
        (_a = timeout.unref) === null || _a === void 0 ? void 0 : _a.call(timeout);
        const cancel = () => {
            clearTimeout(timeout);
        };
        cancelers.push(cancel);
        return cancel;
    };
    const { host, hostname } = options;
    const timeoutHandler = (delay, event) => {
        request.destroy(new TimeoutError(delay, event));
    };
    const cancelTimeouts = () => {
        for (const cancel of cancelers) {
            cancel();
        }
        unhandleAll();
    };
    request.once('error', error => {
        cancelTimeouts();
        // Save original behavior
        /* istanbul ignore next */
        if (request.listenerCount('error') === 0) {
            throw error;
        }
    });
    request.once('close', cancelTimeouts);
    once(request, 'response', (response) => {
        once(response, 'end', cancelTimeouts);
    });
    if (typeof delays.request !== 'undefined') {
        addTimeout(delays.request, timeoutHandler, 'request');
    }
    if (typeof delays.socket !== 'undefined') {
        const socketTimeoutHandler = () => {
            timeoutHandler(delays.socket, 'socket');
        };
        request.setTimeout(delays.socket, socketTimeoutHandler);
        // `request.setTimeout(0)` causes a memory leak.
        // We can just remove the listener and forget about the timer - it's unreffed.
        // See https://github.com/sindresorhus/got/issues/690
        cancelers.push(() => {
            request.removeListener('timeout', socketTimeoutHandler);
        });
    }
    once(request, 'socket', (socket) => {
        var _a;
        const { socketPath } = request;
        /* istanbul ignore next: hard to test */
        if (socket.connecting) {
            const hasPath = Boolean(socketPath !== null && socketPath !== void 0 ? socketPath : net__default["default"].isIP((_a = hostname !== null && hostname !== void 0 ? hostname : host) !== null && _a !== void 0 ? _a : '') !== 0);
            if (typeof delays.lookup !== 'undefined' && !hasPath && typeof socket.address().address === 'undefined') {
                const cancelTimeout = addTimeout(delays.lookup, timeoutHandler, 'lookup');
                once(socket, 'lookup', cancelTimeout);
            }
            if (typeof delays.connect !== 'undefined') {
                const timeConnect = () => addTimeout(delays.connect, timeoutHandler, 'connect');
                if (hasPath) {
                    once(socket, 'connect', timeConnect());
                }
                else {
                    once(socket, 'lookup', (error) => {
                        if (error === null) {
                            once(socket, 'connect', timeConnect());
                        }
                    });
                }
            }
            if (typeof delays.secureConnect !== 'undefined' && options.protocol === 'https:') {
                once(socket, 'connect', () => {
                    const cancelTimeout = addTimeout(delays.secureConnect, timeoutHandler, 'secureConnect');
                    once(socket, 'secureConnect', cancelTimeout);
                });
            }
        }
        if (typeof delays.send !== 'undefined') {
            const timeRequest = () => addTimeout(delays.send, timeoutHandler, 'send');
            /* istanbul ignore next: hard to test */
            if (socket.connecting) {
                once(socket, 'connect', () => {
                    once(request, 'upload-complete', timeRequest());
                });
            }
            else {
                once(request, 'upload-complete', timeRequest());
            }
        }
    });
    if (typeof delays.response !== 'undefined') {
        once(request, 'upload-complete', () => {
            const cancelTimeout = addTimeout(delays.response, timeoutHandler, 'response');
            once(request, 'response', cancelTimeout);
        });
    }
    return cancelTimeouts;
};
});

var urlToOptions = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });

exports.default = (url) => {
    // Cast to URL
    url = url;
    const options = {
        protocol: url.protocol,
        hostname: is_1.default.string(url.hostname) && url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname,
        host: url.host,
        hash: url.hash,
        search: url.search,
        pathname: url.pathname,
        href: url.href,
        path: `${url.pathname || ''}${url.search || ''}`
    };
    if (is_1.default.string(url.port) && url.port.length > 0) {
        options.port = Number(url.port);
    }
    if (url.username || url.password) {
        options.auth = `${url.username || ''}:${url.password || ''}`;
    }
    return options;
};
});

var optionsToUrl = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });
/* istanbul ignore file: deprecated */

const keys = [
    'protocol',
    'host',
    'hostname',
    'port',
    'pathname',
    'search'
];
exports.default = (origin, options) => {
    var _a, _b;
    if (options.path) {
        if (options.pathname) {
            throw new TypeError('Parameters `path` and `pathname` are mutually exclusive.');
        }
        if (options.search) {
            throw new TypeError('Parameters `path` and `search` are mutually exclusive.');
        }
        if (options.searchParams) {
            throw new TypeError('Parameters `path` and `searchParams` are mutually exclusive.');
        }
    }
    if (options.search && options.searchParams) {
        throw new TypeError('Parameters `search` and `searchParams` are mutually exclusive.');
    }
    if (!origin) {
        if (!options.protocol) {
            throw new TypeError('No URL protocol specified');
        }
        origin = `${options.protocol}//${(_b = (_a = options.hostname) !== null && _a !== void 0 ? _a : options.host) !== null && _b !== void 0 ? _b : ''}`;
    }
    const url = new url_1__default["default"].URL(origin);
    if (options.path) {
        const searchIndex = options.path.indexOf('?');
        if (searchIndex === -1) {
            options.pathname = options.path;
        }
        else {
            options.pathname = options.path.slice(0, searchIndex);
            options.search = options.path.slice(searchIndex + 1);
        }
        delete options.path;
    }
    for (const key of keys) {
        if (options[key]) {
            url[key] = options[key].toString();
        }
    }
    return url;
};
});

var weakableMap = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });
class WeakableMap {
    constructor() {
        this.weakMap = new WeakMap();
        this.map = new Map();
    }
    set(key, value) {
        if (typeof key === 'object') {
            this.weakMap.set(key, value);
        }
        else {
            this.map.set(key, value);
        }
    }
    get(key) {
        if (typeof key === 'object') {
            return this.weakMap.get(key);
        }
        return this.map.get(key);
    }
    has(key) {
        if (typeof key === 'object') {
            return this.weakMap.has(key);
        }
        return this.map.has(key);
    }
}
exports.default = WeakableMap;
});

var getBuffer_1 = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });
// TODO: Update https://github.com/sindresorhus/get-stream
const getBuffer = async (stream) => {
    const chunks = [];
    let length = 0;
    for await (const chunk of stream) {
        chunks.push(chunk);
        length += Buffer.byteLength(chunk);
    }
    if (Buffer.isBuffer(chunks[0])) {
        return Buffer.concat(chunks, length);
    }
    return Buffer.from(chunks.join(''));
};
exports.default = getBuffer;
});

var dnsIpVersion = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });
exports.dnsLookupIpVersionToFamily = exports.isDnsLookupIpVersion = void 0;
const conversionTable = {
    auto: 0,
    ipv4: 4,
    ipv6: 6
};
exports.isDnsLookupIpVersion = (value) => {
    return value in conversionTable;
};
exports.dnsLookupIpVersionToFamily = (dnsLookupIpVersion) => {
    if (exports.isDnsLookupIpVersion(dnsLookupIpVersion)) {
        return conversionTable[dnsLookupIpVersion];
    }
    throw new Error('Invalid DNS lookup IP version');
};
});

var isResponseOk = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });
exports.isResponseOk = void 0;
exports.isResponseOk = (response) => {
    const { statusCode } = response;
    const limitStatusCode = response.request.options.followRedirect ? 299 : 399;
    return (statusCode >= 200 && statusCode <= limitStatusCode) || statusCode === 304;
};
});

var deprecationWarning = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });
const alreadyWarned = new Set();
exports.default = (message) => {
    if (alreadyWarned.has(message)) {
        return;
    }
    alreadyWarned.add(message);
    // @ts-expect-error Missing types.
    process.emitWarning(`Got: ${message}`, {
        type: 'DeprecationWarning'
    });
};
});

var normalizeArguments_1 = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });

const normalizeArguments = (options, defaults) => {
    if (is_1.default.null_(options.encoding)) {
        throw new TypeError('To get a Buffer, set `options.responseType` to `buffer` instead');
    }
    is_1.assert.any([is_1.default.string, is_1.default.undefined], options.encoding);
    is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.resolveBodyOnly);
    is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.methodRewriting);
    is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.isStream);
    is_1.assert.any([is_1.default.string, is_1.default.undefined], options.responseType);
    // `options.responseType`
    if (options.responseType === undefined) {
        options.responseType = 'text';
    }
    // `options.retry`
    const { retry } = options;
    if (defaults) {
        options.retry = { ...defaults.retry };
    }
    else {
        options.retry = {
            calculateDelay: retryObject => retryObject.computedValue,
            limit: 0,
            methods: [],
            statusCodes: [],
            errorCodes: [],
            maxRetryAfter: undefined
        };
    }
    if (is_1.default.object(retry)) {
        options.retry = {
            ...options.retry,
            ...retry
        };
        options.retry.methods = [...new Set(options.retry.methods.map(method => method.toUpperCase()))];
        options.retry.statusCodes = [...new Set(options.retry.statusCodes)];
        options.retry.errorCodes = [...new Set(options.retry.errorCodes)];
    }
    else if (is_1.default.number(retry)) {
        options.retry.limit = retry;
    }
    if (is_1.default.undefined(options.retry.maxRetryAfter)) {
        options.retry.maxRetryAfter = Math.min(
        // TypeScript is not smart enough to handle `.filter(x => is.number(x))`.
        // eslint-disable-next-line unicorn/no-fn-reference-in-iterator
        ...[options.timeout.request, options.timeout.connect].filter(is_1.default.number));
    }
    // `options.pagination`
    if (is_1.default.object(options.pagination)) {
        if (defaults) {
            options.pagination = {
                ...defaults.pagination,
                ...options.pagination
            };
        }
        const { pagination } = options;
        if (!is_1.default.function_(pagination.transform)) {
            throw new Error('`options.pagination.transform` must be implemented');
        }
        if (!is_1.default.function_(pagination.shouldContinue)) {
            throw new Error('`options.pagination.shouldContinue` must be implemented');
        }
        if (!is_1.default.function_(pagination.filter)) {
            throw new TypeError('`options.pagination.filter` must be implemented');
        }
        if (!is_1.default.function_(pagination.paginate)) {
            throw new Error('`options.pagination.paginate` must be implemented');
        }
    }
    // JSON mode
    if (options.responseType === 'json' && options.headers.accept === undefined) {
        options.headers.accept = 'application/json';
    }
    return options;
};
exports.default = normalizeArguments;
});

var calculateRetryDelay_1 = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });
exports.retryAfterStatusCodes = void 0;
exports.retryAfterStatusCodes = new Set([413, 429, 503]);
const calculateRetryDelay = ({ attemptCount, retryOptions, error, retryAfter }) => {
    if (attemptCount > retryOptions.limit) {
        return 0;
    }
    const hasMethod = retryOptions.methods.includes(error.options.method);
    const hasErrorCode = retryOptions.errorCodes.includes(error.code);
    const hasStatusCode = error.response && retryOptions.statusCodes.includes(error.response.statusCode);
    if (!hasMethod || (!hasErrorCode && !hasStatusCode)) {
        return 0;
    }
    if (error.response) {
        if (retryAfter) {
            if (retryOptions.maxRetryAfter === undefined || retryAfter > retryOptions.maxRetryAfter) {
                return 0;
            }
            return retryAfter;
        }
        if (error.response.statusCode === 413) {
            return 0;
        }
    }
    const noise = Math.random() * 100;
    return ((2 ** (attemptCount - 1)) * 1000) + noise;
};
exports.default = calculateRetryDelay;
});

var get_body_size_1 = getBodySize;

var proxy_events_1 = proxyEvents;

var timed_out_1 = timedOut;

var url_to_options_1 = urlToOptions;

var options_to_url_1 = optionsToUrl;

var weakable_map_1 = weakableMap;

var get_buffer_1 = getBuffer_1;

var dns_ip_version_1 = dnsIpVersion;

var is_response_ok_1 = isResponseOk;

var deprecation_warning_1 = deprecationWarning;

var normalize_arguments_1 = normalizeArguments_1;

var calculate_retry_delay_1 = calculateRetryDelay_1;

var core = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnsupportedProtocolError = exports.ReadError = exports.TimeoutError = exports.UploadError = exports.CacheError = exports.HTTPError = exports.MaxRedirectsError = exports.RequestError = exports.setNonEnumerableProperties = exports.knownHookEvents = exports.withoutBody = exports.kIsNormalizedAlready = void 0;





const http_1 = http__default["default"];





// @ts-expect-error Missing types
















let globalDnsCache;
const kRequest = Symbol('request');
const kResponse = Symbol('response');
const kResponseSize = Symbol('responseSize');
const kDownloadedSize = Symbol('downloadedSize');
const kBodySize = Symbol('bodySize');
const kUploadedSize = Symbol('uploadedSize');
const kServerResponsesPiped = Symbol('serverResponsesPiped');
const kUnproxyEvents = Symbol('unproxyEvents');
const kIsFromCache = Symbol('isFromCache');
const kCancelTimeouts = Symbol('cancelTimeouts');
const kStartedReading = Symbol('startedReading');
const kStopReading = Symbol('stopReading');
const kTriggerRead = Symbol('triggerRead');
const kBody = Symbol('body');
const kJobs = Symbol('jobs');
const kOriginalResponse = Symbol('originalResponse');
const kRetryTimeout = Symbol('retryTimeout');
exports.kIsNormalizedAlready = Symbol('isNormalizedAlready');
const supportsBrotli = is_1.default.string(process.versions.brotli);
exports.withoutBody = new Set(['GET', 'HEAD']);
exports.knownHookEvents = [
    'init',
    'beforeRequest',
    'beforeRedirect',
    'beforeError',
    'beforeRetry',
    // Promise-Only
    'afterResponse'
];
function validateSearchParameters(searchParameters) {
    // eslint-disable-next-line guard-for-in
    for (const key in searchParameters) {
        const value = searchParameters[key];
        if (!is_1.default.string(value) && !is_1.default.number(value) && !is_1.default.boolean(value) && !is_1.default.null_(value) && !is_1.default.undefined(value)) {
            throw new TypeError(`The \`searchParams\` value '${String(value)}' must be a string, number, boolean or null`);
        }
    }
}
function isClientRequest(clientRequest) {
    return is_1.default.object(clientRequest) && !('statusCode' in clientRequest);
}
const cacheableStore = new weakable_map_1.default();
const waitForOpenFile = async (file) => new Promise((resolve, reject) => {
    const onError = (error) => {
        reject(error);
    };
    // Node.js 12 has incomplete types
    if (!file.pending) {
        resolve();
    }
    file.once('error', onError);
    file.once('ready', () => {
        file.off('error', onError);
        resolve();
    });
});
const redirectCodes = new Set([300, 301, 302, 303, 304, 307, 308]);
const nonEnumerableProperties = [
    'context',
    'body',
    'json',
    'form'
];
exports.setNonEnumerableProperties = (sources, to) => {
    // Non enumerable properties shall not be merged
    const properties = {};
    for (const source of sources) {
        if (!source) {
            continue;
        }
        for (const name of nonEnumerableProperties) {
            if (!(name in source)) {
                continue;
            }
            properties[name] = {
                writable: true,
                configurable: true,
                enumerable: false,
                // @ts-expect-error TS doesn't see the check above
                value: source[name]
            };
        }
    }
    Object.defineProperties(to, properties);
};
/**
An error to be thrown when a request fails.
Contains a `code` property with error class code, like `ECONNREFUSED`.
*/
class RequestError extends Error {
    constructor(message, error, self) {
        var _a;
        super(message);
        Error.captureStackTrace(this, this.constructor);
        this.name = 'RequestError';
        this.code = error.code;
        if (self instanceof Request) {
            Object.defineProperty(this, 'request', {
                enumerable: false,
                value: self
            });
            Object.defineProperty(this, 'response', {
                enumerable: false,
                value: self[kResponse]
            });
            Object.defineProperty(this, 'options', {
                // This fails because of TS 3.7.2 useDefineForClassFields
                // Ref: https://github.com/microsoft/TypeScript/issues/34972
                enumerable: false,
                value: self.options
            });
        }
        else {
            Object.defineProperty(this, 'options', {
                // This fails because of TS 3.7.2 useDefineForClassFields
                // Ref: https://github.com/microsoft/TypeScript/issues/34972
                enumerable: false,
                value: self
            });
        }
        this.timings = (_a = this.request) === null || _a === void 0 ? void 0 : _a.timings;
        // Recover the original stacktrace
        if (is_1.default.string(error.stack) && is_1.default.string(this.stack)) {
            const indexOfMessage = this.stack.indexOf(this.message) + this.message.length;
            const thisStackTrace = this.stack.slice(indexOfMessage).split('\n').reverse();
            const errorStackTrace = error.stack.slice(error.stack.indexOf(error.message) + error.message.length).split('\n').reverse();
            // Remove duplicated traces
            while (errorStackTrace.length !== 0 && errorStackTrace[0] === thisStackTrace[0]) {
                thisStackTrace.shift();
            }
            this.stack = `${this.stack.slice(0, indexOfMessage)}${thisStackTrace.reverse().join('\n')}${errorStackTrace.reverse().join('\n')}`;
        }
    }
}
exports.RequestError = RequestError;
/**
An error to be thrown when the server redirects you more than ten times.
Includes a `response` property.
*/
class MaxRedirectsError extends RequestError {
    constructor(request) {
        super(`Redirected ${request.options.maxRedirects} times. Aborting.`, {}, request);
        this.name = 'MaxRedirectsError';
    }
}
exports.MaxRedirectsError = MaxRedirectsError;
/**
An error to be thrown when the server response code is not 2xx nor 3xx if `options.followRedirect` is `true`, but always except for 304.
Includes a `response` property.
*/
class HTTPError extends RequestError {
    constructor(response) {
        super(`Response code ${response.statusCode} (${response.statusMessage})`, {}, response.request);
        this.name = 'HTTPError';
    }
}
exports.HTTPError = HTTPError;
/**
An error to be thrown when a cache method fails.
For example, if the database goes down or there's a filesystem error.
*/
class CacheError extends RequestError {
    constructor(error, request) {
        super(error.message, error, request);
        this.name = 'CacheError';
    }
}
exports.CacheError = CacheError;
/**
An error to be thrown when the request body is a stream and an error occurs while reading from that stream.
*/
class UploadError extends RequestError {
    constructor(error, request) {
        super(error.message, error, request);
        this.name = 'UploadError';
    }
}
exports.UploadError = UploadError;
/**
An error to be thrown when the request is aborted due to a timeout.
Includes an `event` and `timings` property.
*/
class TimeoutError extends RequestError {
    constructor(error, timings, request) {
        super(error.message, error, request);
        this.name = 'TimeoutError';
        this.event = error.event;
        this.timings = timings;
    }
}
exports.TimeoutError = TimeoutError;
/**
An error to be thrown when reading from response stream fails.
*/
class ReadError extends RequestError {
    constructor(error, request) {
        super(error.message, error, request);
        this.name = 'ReadError';
    }
}
exports.ReadError = ReadError;
/**
An error to be thrown when given an unsupported protocol.
*/
class UnsupportedProtocolError extends RequestError {
    constructor(options) {
        super(`Unsupported protocol "${options.url.protocol}"`, {}, options);
        this.name = 'UnsupportedProtocolError';
    }
}
exports.UnsupportedProtocolError = UnsupportedProtocolError;
const proxiedRequestEvents = [
    'socket',
    'connect',
    'continue',
    'information',
    'upgrade',
    'timeout'
];
class Request extends require$$0__default$2["default"].Duplex {
    constructor(url, options = {}, defaults) {
        super({
            // This must be false, to enable throwing after destroy
            // It is used for retry logic in Promise API
            autoDestroy: false,
            // It needs to be zero because we're just proxying the data to another stream
            highWaterMark: 0
        });
        this[kDownloadedSize] = 0;
        this[kUploadedSize] = 0;
        this.requestInitialized = false;
        this[kServerResponsesPiped] = new Set();
        this.redirects = [];
        this[kStopReading] = false;
        this[kTriggerRead] = false;
        this[kJobs] = [];
        this.retryCount = 0;
        // TODO: Remove this when targeting Node.js >= 12
        this._progressCallbacks = [];
        const unlockWrite = () => this._unlockWrite();
        const lockWrite = () => this._lockWrite();
        this.on('pipe', (source) => {
            source.prependListener('data', unlockWrite);
            source.on('data', lockWrite);
            source.prependListener('end', unlockWrite);
            source.on('end', lockWrite);
        });
        this.on('unpipe', (source) => {
            source.off('data', unlockWrite);
            source.off('data', lockWrite);
            source.off('end', unlockWrite);
            source.off('end', lockWrite);
        });
        this.on('pipe', source => {
            if (source instanceof http_1.IncomingMessage) {
                this.options.headers = {
                    ...source.headers,
                    ...this.options.headers
                };
            }
        });
        const { json, body, form } = options;
        if (json || body || form) {
            this._lockWrite();
        }
        if (exports.kIsNormalizedAlready in options) {
            this.options = options;
        }
        else {
            try {
                // @ts-expect-error Common TypeScript bug saying that `this.constructor` is not accessible
                this.options = this.constructor.normalizeArguments(url, options, defaults);
            }
            catch (error) {
                // TODO: Move this to `_destroy()`
                if (is_1.default.nodeStream(options.body)) {
                    options.body.destroy();
                }
                this.destroy(error);
                return;
            }
        }
        (async () => {
            var _a;
            try {
                if (this.options.body instanceof fs__default["default"].ReadStream) {
                    await waitForOpenFile(this.options.body);
                }
                const { url: normalizedURL } = this.options;
                if (!normalizedURL) {
                    throw new TypeError('Missing `url` property');
                }
                this.requestUrl = normalizedURL.toString();
                decodeURI(this.requestUrl);
                await this._finalizeBody();
                await this._makeRequest();
                if (this.destroyed) {
                    (_a = this[kRequest]) === null || _a === void 0 ? void 0 : _a.destroy();
                    return;
                }
                // Queued writes etc.
                for (const job of this[kJobs]) {
                    job();
                }
                // Prevent memory leak
                this[kJobs].length = 0;
                this.requestInitialized = true;
            }
            catch (error) {
                if (error instanceof RequestError) {
                    this._beforeError(error);
                    return;
                }
                // This is a workaround for https://github.com/nodejs/node/issues/33335
                if (!this.destroyed) {
                    this.destroy(error);
                }
            }
        })();
    }
    static normalizeArguments(url, options, defaults) {
        var _a, _b, _c, _d, _e;
        const rawOptions = options;
        if (is_1.default.object(url) && !is_1.default.urlInstance(url)) {
            options = { ...defaults, ...url, ...options };
        }
        else {
            if (url && options && options.url !== undefined) {
                throw new TypeError('The `url` option is mutually exclusive with the `input` argument');
            }
            options = { ...defaults, ...options };
            if (url !== undefined) {
                options.url = url;
            }
            if (is_1.default.urlInstance(options.url)) {
                options.url = new url_1__default["default"].URL(options.url.toString());
            }
        }
        // TODO: Deprecate URL options in Got 12.
        // Support extend-specific options
        if (options.cache === false) {
            options.cache = undefined;
        }
        if (options.dnsCache === false) {
            options.dnsCache = undefined;
        }
        // Nice type assertions
        is_1.assert.any([is_1.default.string, is_1.default.undefined], options.method);
        is_1.assert.any([is_1.default.object, is_1.default.undefined], options.headers);
        is_1.assert.any([is_1.default.string, is_1.default.urlInstance, is_1.default.undefined], options.prefixUrl);
        is_1.assert.any([is_1.default.object, is_1.default.undefined], options.cookieJar);
        is_1.assert.any([is_1.default.object, is_1.default.string, is_1.default.undefined], options.searchParams);
        is_1.assert.any([is_1.default.object, is_1.default.string, is_1.default.undefined], options.cache);
        is_1.assert.any([is_1.default.object, is_1.default.number, is_1.default.undefined], options.timeout);
        is_1.assert.any([is_1.default.object, is_1.default.undefined], options.context);
        is_1.assert.any([is_1.default.object, is_1.default.undefined], options.hooks);
        is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.decompress);
        is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.ignoreInvalidCookies);
        is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.followRedirect);
        is_1.assert.any([is_1.default.number, is_1.default.undefined], options.maxRedirects);
        is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.throwHttpErrors);
        is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.http2);
        is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.allowGetBody);
        is_1.assert.any([is_1.default.string, is_1.default.undefined], options.localAddress);
        is_1.assert.any([dns_ip_version_1.isDnsLookupIpVersion, is_1.default.undefined], options.dnsLookupIpVersion);
        is_1.assert.any([is_1.default.object, is_1.default.undefined], options.https);
        is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.rejectUnauthorized);
        if (options.https) {
            is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.https.rejectUnauthorized);
            is_1.assert.any([is_1.default.function_, is_1.default.undefined], options.https.checkServerIdentity);
            is_1.assert.any([is_1.default.string, is_1.default.object, is_1.default.array, is_1.default.undefined], options.https.certificateAuthority);
            is_1.assert.any([is_1.default.string, is_1.default.object, is_1.default.array, is_1.default.undefined], options.https.key);
            is_1.assert.any([is_1.default.string, is_1.default.object, is_1.default.array, is_1.default.undefined], options.https.certificate);
            is_1.assert.any([is_1.default.string, is_1.default.undefined], options.https.passphrase);
            is_1.assert.any([is_1.default.string, is_1.default.buffer, is_1.default.array, is_1.default.undefined], options.https.pfx);
        }
        is_1.assert.any([is_1.default.object, is_1.default.undefined], options.cacheOptions);
        // `options.method`
        if (is_1.default.string(options.method)) {
            options.method = options.method.toUpperCase();
        }
        else {
            options.method = 'GET';
        }
        // `options.headers`
        if (options.headers === (defaults === null || defaults === void 0 ? void 0 : defaults.headers)) {
            options.headers = { ...options.headers };
        }
        else {
            options.headers = lowercaseKeys({ ...(defaults === null || defaults === void 0 ? void 0 : defaults.headers), ...options.headers });
        }
        // Disallow legacy `url.Url`
        if ('slashes' in options) {
            throw new TypeError('The legacy `url.Url` has been deprecated. Use `URL` instead.');
        }
        // `options.auth`
        if ('auth' in options) {
            throw new TypeError('Parameter `auth` is deprecated. Use `username` / `password` instead.');
        }
        // `options.searchParams`
        if ('searchParams' in options) {
            if (options.searchParams && options.searchParams !== (defaults === null || defaults === void 0 ? void 0 : defaults.searchParams)) {
                let searchParameters;
                if (is_1.default.string(options.searchParams) || (options.searchParams instanceof url_1__default["default"].URLSearchParams)) {
                    searchParameters = new url_1__default["default"].URLSearchParams(options.searchParams);
                }
                else {
                    validateSearchParameters(options.searchParams);
                    searchParameters = new url_1__default["default"].URLSearchParams();
                    // eslint-disable-next-line guard-for-in
                    for (const key in options.searchParams) {
                        const value = options.searchParams[key];
                        if (value === null) {
                            searchParameters.append(key, '');
                        }
                        else if (value !== undefined) {
                            searchParameters.append(key, value);
                        }
                    }
                }
                // `normalizeArguments()` is also used to merge options
                (_a = defaults === null || defaults === void 0 ? void 0 : defaults.searchParams) === null || _a === void 0 ? void 0 : _a.forEach((value, key) => {
                    // Only use default if one isn't already defined
                    if (!searchParameters.has(key)) {
                        searchParameters.append(key, value);
                    }
                });
                options.searchParams = searchParameters;
            }
        }
        // `options.username` & `options.password`
        options.username = (_b = options.username) !== null && _b !== void 0 ? _b : '';
        options.password = (_c = options.password) !== null && _c !== void 0 ? _c : '';
        // `options.prefixUrl` & `options.url`
        if (is_1.default.undefined(options.prefixUrl)) {
            options.prefixUrl = (_d = defaults === null || defaults === void 0 ? void 0 : defaults.prefixUrl) !== null && _d !== void 0 ? _d : '';
        }
        else {
            options.prefixUrl = options.prefixUrl.toString();
            if (options.prefixUrl !== '' && !options.prefixUrl.endsWith('/')) {
                options.prefixUrl += '/';
            }
        }
        if (is_1.default.string(options.url)) {
            if (options.url.startsWith('/')) {
                throw new Error('`input` must not start with a slash when using `prefixUrl`');
            }
            options.url = options_to_url_1.default(options.prefixUrl + options.url, options);
        }
        else if ((is_1.default.undefined(options.url) && options.prefixUrl !== '') || options.protocol) {
            options.url = options_to_url_1.default(options.prefixUrl, options);
        }
        if (options.url) {
            if ('port' in options) {
                delete options.port;
            }
            // Make it possible to change `options.prefixUrl`
            let { prefixUrl } = options;
            Object.defineProperty(options, 'prefixUrl', {
                set: (value) => {
                    const url = options.url;
                    if (!url.href.startsWith(value)) {
                        throw new Error(`Cannot change \`prefixUrl\` from ${prefixUrl} to ${value}: ${url.href}`);
                    }
                    options.url = new url_1__default["default"].URL(value + url.href.slice(prefixUrl.length));
                    prefixUrl = value;
                },
                get: () => prefixUrl
            });
            // Support UNIX sockets
            let { protocol } = options.url;
            if (protocol === 'unix:') {
                protocol = 'http:';
                options.url = new url_1__default["default"].URL(`http://unix${options.url.pathname}${options.url.search}`);
            }
            // Set search params
            if (options.searchParams) {
                // eslint-disable-next-line @typescript-eslint/no-base-to-string
                options.url.search = options.searchParams.toString();
            }
            // Protocol check
            if (protocol !== 'http:' && protocol !== 'https:') {
                throw new UnsupportedProtocolError(options);
            }
            // Update `username`
            if (options.username === '') {
                options.username = options.url.username;
            }
            else {
                options.url.username = options.username;
            }
            // Update `password`
            if (options.password === '') {
                options.password = options.url.password;
            }
            else {
                options.url.password = options.password;
            }
        }
        // `options.cookieJar`
        const { cookieJar } = options;
        if (cookieJar) {
            let { setCookie, getCookieString } = cookieJar;
            is_1.assert.function_(setCookie);
            is_1.assert.function_(getCookieString);
            /* istanbul ignore next: Horrible `tough-cookie` v3 check */
            if (setCookie.length === 4 && getCookieString.length === 0) {
                setCookie = util_1__default["default"].promisify(setCookie.bind(options.cookieJar));
                getCookieString = util_1__default["default"].promisify(getCookieString.bind(options.cookieJar));
                options.cookieJar = {
                    setCookie,
                    getCookieString: getCookieString
                };
            }
        }
        // `options.cache`
        const { cache } = options;
        if (cache) {
            if (!cacheableStore.has(cache)) {
                cacheableStore.set(cache, new src(((requestOptions, handler) => {
                    const result = requestOptions[kRequest](requestOptions, handler);
                    // TODO: remove this when `cacheable-request` supports async request functions.
                    if (is_1.default.promise(result)) {
                        // @ts-expect-error
                        // We only need to implement the error handler in order to support HTTP2 caching.
                        // The result will be a promise anyway.
                        result.once = (event, handler) => {
                            if (event === 'error') {
                                result.catch(handler);
                            }
                            else if (event === 'abort') {
                                // The empty catch is needed here in case when
                                // it rejects before it's `await`ed in `_makeRequest`.
                                (async () => {
                                    try {
                                        const request = (await result);
                                        request.once('abort', handler);
                                    }
                                    catch (_a) { }
                                })();
                            }
                            else {
                                /* istanbul ignore next: safety check */
                                throw new Error(`Unknown HTTP2 promise event: ${event}`);
                            }
                            return result;
                        };
                    }
                    return result;
                }), cache));
            }
        }
        // `options.cacheOptions`
        options.cacheOptions = { ...options.cacheOptions };
        // `options.dnsCache`
        if (options.dnsCache === true) {
            if (!globalDnsCache) {
                globalDnsCache = new source$2.default();
            }
            options.dnsCache = globalDnsCache;
        }
        else if (!is_1.default.undefined(options.dnsCache) && !options.dnsCache.lookup) {
            throw new TypeError(`Parameter \`dnsCache\` must be a CacheableLookup instance or a boolean, got ${is_1.default(options.dnsCache)}`);
        }
        // `options.timeout`
        if (is_1.default.number(options.timeout)) {
            options.timeout = { request: options.timeout };
        }
        else if (defaults && options.timeout !== defaults.timeout) {
            options.timeout = {
                ...defaults.timeout,
                ...options.timeout
            };
        }
        else {
            options.timeout = { ...options.timeout };
        }
        // `options.context`
        if (!options.context) {
            options.context = {};
        }
        // `options.hooks`
        const areHooksDefault = options.hooks === (defaults === null || defaults === void 0 ? void 0 : defaults.hooks);
        options.hooks = { ...options.hooks };
        for (const event of exports.knownHookEvents) {
            if (event in options.hooks) {
                if (is_1.default.array(options.hooks[event])) {
                    // See https://github.com/microsoft/TypeScript/issues/31445#issuecomment-576929044
                    options.hooks[event] = [...options.hooks[event]];
                }
                else {
                    throw new TypeError(`Parameter \`${event}\` must be an Array, got ${is_1.default(options.hooks[event])}`);
                }
            }
            else {
                options.hooks[event] = [];
            }
        }
        if (defaults && !areHooksDefault) {
            for (const event of exports.knownHookEvents) {
                const defaultHooks = defaults.hooks[event];
                if (defaultHooks.length > 0) {
                    // See https://github.com/microsoft/TypeScript/issues/31445#issuecomment-576929044
                    options.hooks[event] = [
                        ...defaults.hooks[event],
                        ...options.hooks[event]
                    ];
                }
            }
        }
        // DNS options
        if ('family' in options) {
            deprecation_warning_1.default('"options.family" was never documented, please use "options.dnsLookupIpVersion"');
        }
        // HTTPS options
        if (defaults === null || defaults === void 0 ? void 0 : defaults.https) {
            options.https = { ...defaults.https, ...options.https };
        }
        if ('rejectUnauthorized' in options) {
            deprecation_warning_1.default('"options.rejectUnauthorized" is now deprecated, please use "options.https.rejectUnauthorized"');
        }
        if ('checkServerIdentity' in options) {
            deprecation_warning_1.default('"options.checkServerIdentity" was never documented, please use "options.https.checkServerIdentity"');
        }
        if ('ca' in options) {
            deprecation_warning_1.default('"options.ca" was never documented, please use "options.https.certificateAuthority"');
        }
        if ('key' in options) {
            deprecation_warning_1.default('"options.key" was never documented, please use "options.https.key"');
        }
        if ('cert' in options) {
            deprecation_warning_1.default('"options.cert" was never documented, please use "options.https.certificate"');
        }
        if ('passphrase' in options) {
            deprecation_warning_1.default('"options.passphrase" was never documented, please use "options.https.passphrase"');
        }
        if ('pfx' in options) {
            deprecation_warning_1.default('"options.pfx" was never documented, please use "options.https.pfx"');
        }
        // Other options
        if ('followRedirects' in options) {
            throw new TypeError('The `followRedirects` option does not exist. Use `followRedirect` instead.');
        }
        if (options.agent) {
            for (const key in options.agent) {
                if (key !== 'http' && key !== 'https' && key !== 'http2') {
                    throw new TypeError(`Expected the \`options.agent\` properties to be \`http\`, \`https\` or \`http2\`, got \`${key}\``);
                }
            }
        }
        options.maxRedirects = (_e = options.maxRedirects) !== null && _e !== void 0 ? _e : 0;
        // Set non-enumerable properties
        exports.setNonEnumerableProperties([defaults, rawOptions], options);
        return normalize_arguments_1.default(options, defaults);
    }
    _lockWrite() {
        const onLockedWrite = () => {
            throw new TypeError('The payload has been already provided');
        };
        this.write = onLockedWrite;
        this.end = onLockedWrite;
    }
    _unlockWrite() {
        this.write = super.write;
        this.end = super.end;
    }
    async _finalizeBody() {
        const { options } = this;
        const { headers } = options;
        const isForm = !is_1.default.undefined(options.form);
        const isJSON = !is_1.default.undefined(options.json);
        const isBody = !is_1.default.undefined(options.body);
        const hasPayload = isForm || isJSON || isBody;
        const cannotHaveBody = exports.withoutBody.has(options.method) && !(options.method === 'GET' && options.allowGetBody);
        this._cannotHaveBody = cannotHaveBody;
        if (hasPayload) {
            if (cannotHaveBody) {
                throw new TypeError(`The \`${options.method}\` method cannot be used with a body`);
            }
            if ([isBody, isForm, isJSON].filter(isTrue => isTrue).length > 1) {
                throw new TypeError('The `body`, `json` and `form` options are mutually exclusive');
            }
            if (isBody &&
                !(options.body instanceof require$$0__default$2["default"].Readable) &&
                !is_1.default.string(options.body) &&
                !is_1.default.buffer(options.body) &&
                !is_form_data_1.default(options.body)) {
                throw new TypeError('The `body` option must be a stream.Readable, string or Buffer');
            }
            if (isForm && !is_1.default.object(options.form)) {
                throw new TypeError('The `form` option must be an Object');
            }
            {
                // Serialize body
                const noContentType = !is_1.default.string(headers['content-type']);
                if (isBody) {
                    // Special case for https://github.com/form-data/form-data
                    if (is_form_data_1.default(options.body) && noContentType) {
                        headers['content-type'] = `multipart/form-data; boundary=${options.body.getBoundary()}`;
                    }
                    this[kBody] = options.body;
                }
                else if (isForm) {
                    if (noContentType) {
                        headers['content-type'] = 'application/x-www-form-urlencoded';
                    }
                    this[kBody] = (new url_1__default["default"].URLSearchParams(options.form)).toString();
                }
                else {
                    if (noContentType) {
                        headers['content-type'] = 'application/json';
                    }
                    this[kBody] = options.stringifyJson(options.json);
                }
                const uploadBodySize = await get_body_size_1.default(this[kBody], options.headers);
                // See https://tools.ietf.org/html/rfc7230#section-3.3.2
                // A user agent SHOULD send a Content-Length in a request message when
                // no Transfer-Encoding is sent and the request method defines a meaning
                // for an enclosed payload body.  For example, a Content-Length header
                // field is normally sent in a POST request even when the value is 0
                // (indicating an empty payload body).  A user agent SHOULD NOT send a
                // Content-Length header field when the request message does not contain
                // a payload body and the method semantics do not anticipate such a
                // body.
                if (is_1.default.undefined(headers['content-length']) && is_1.default.undefined(headers['transfer-encoding'])) {
                    if (!cannotHaveBody && !is_1.default.undefined(uploadBodySize)) {
                        headers['content-length'] = String(uploadBodySize);
                    }
                }
            }
        }
        else if (cannotHaveBody) {
            this._lockWrite();
        }
        else {
            this._unlockWrite();
        }
        this[kBodySize] = Number(headers['content-length']) || undefined;
    }
    async _onResponseBase(response) {
        const { options } = this;
        const { url } = options;
        this[kOriginalResponse] = response;
        if (options.decompress) {
            response = decompressResponse(response);
        }
        const statusCode = response.statusCode;
        const typedResponse = response;
        typedResponse.statusMessage = typedResponse.statusMessage ? typedResponse.statusMessage : http__default["default"].STATUS_CODES[statusCode];
        typedResponse.url = options.url.toString();
        typedResponse.requestUrl = this.requestUrl;
        typedResponse.redirectUrls = this.redirects;
        typedResponse.request = this;
        typedResponse.isFromCache = response.fromCache || false;
        typedResponse.ip = this.ip;
        typedResponse.retryCount = this.retryCount;
        this[kIsFromCache] = typedResponse.isFromCache;
        this[kResponseSize] = Number(response.headers['content-length']) || undefined;
        this[kResponse] = response;
        response.once('end', () => {
            this[kResponseSize] = this[kDownloadedSize];
            this.emit('downloadProgress', this.downloadProgress);
        });
        response.once('error', (error) => {
            // Force clean-up, because some packages don't do this.
            // TODO: Fix decompress-response
            response.destroy();
            this._beforeError(new ReadError(error, this));
        });
        response.once('aborted', () => {
            this._beforeError(new ReadError({
                name: 'Error',
                message: 'The server aborted pending request',
                code: 'ECONNRESET'
            }, this));
        });
        this.emit('downloadProgress', this.downloadProgress);
        const rawCookies = response.headers['set-cookie'];
        if (is_1.default.object(options.cookieJar) && rawCookies) {
            let promises = rawCookies.map(async (rawCookie) => options.cookieJar.setCookie(rawCookie, url.toString()));
            if (options.ignoreInvalidCookies) {
                promises = promises.map(async (p) => p.catch(() => { }));
            }
            try {
                await Promise.all(promises);
            }
            catch (error) {
                this._beforeError(error);
                return;
            }
        }
        if (options.followRedirect && response.headers.location && redirectCodes.has(statusCode)) {
            // We're being redirected, we don't care about the response.
            // It'd be best to abort the request, but we can't because
            // we would have to sacrifice the TCP connection. We don't want that.
            response.resume();
            if (this[kRequest]) {
                this[kCancelTimeouts]();
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete this[kRequest];
                this[kUnproxyEvents]();
            }
            const shouldBeGet = statusCode === 303 && options.method !== 'GET' && options.method !== 'HEAD';
            if (shouldBeGet || !options.methodRewriting) {
                // Server responded with "see other", indicating that the resource exists at another location,
                // and the client should request it from that location via GET or HEAD.
                options.method = 'GET';
                if ('body' in options) {
                    delete options.body;
                }
                if ('json' in options) {
                    delete options.json;
                }
                if ('form' in options) {
                    delete options.form;
                }
                this[kBody] = undefined;
                delete options.headers['content-length'];
            }
            if (this.redirects.length >= options.maxRedirects) {
                this._beforeError(new MaxRedirectsError(this));
                return;
            }
            try {
                // Do not remove. See https://github.com/sindresorhus/got/pull/214
                const redirectBuffer = Buffer.from(response.headers.location, 'binary').toString();
                // Handles invalid URLs. See https://github.com/sindresorhus/got/issues/604
                const redirectUrl = new url_1__default["default"].URL(redirectBuffer, url);
                const redirectString = redirectUrl.toString();
                decodeURI(redirectString);
                // Redirecting to a different site, clear sensitive data.
                if (redirectUrl.hostname !== url.hostname || redirectUrl.port !== url.port) {
                    if ('host' in options.headers) {
                        delete options.headers.host;
                    }
                    if ('cookie' in options.headers) {
                        delete options.headers.cookie;
                    }
                    if ('authorization' in options.headers) {
                        delete options.headers.authorization;
                    }
                    if (options.username || options.password) {
                        options.username = '';
                        options.password = '';
                    }
                }
                else {
                    redirectUrl.username = options.username;
                    redirectUrl.password = options.password;
                }
                this.redirects.push(redirectString);
                options.url = redirectUrl;
                for (const hook of options.hooks.beforeRedirect) {
                    // eslint-disable-next-line no-await-in-loop
                    await hook(options, typedResponse);
                }
                this.emit('redirect', typedResponse, options);
                await this._makeRequest();
            }
            catch (error) {
                this._beforeError(error);
                return;
            }
            return;
        }
        if (options.isStream && options.throwHttpErrors && !is_response_ok_1.isResponseOk(typedResponse)) {
            this._beforeError(new HTTPError(typedResponse));
            return;
        }
        response.on('readable', () => {
            if (this[kTriggerRead]) {
                this._read();
            }
        });
        this.on('resume', () => {
            response.resume();
        });
        this.on('pause', () => {
            response.pause();
        });
        response.once('end', () => {
            this.push(null);
        });
        this.emit('response', response);
        for (const destination of this[kServerResponsesPiped]) {
            if (destination.headersSent) {
                continue;
            }
            // eslint-disable-next-line guard-for-in
            for (const key in response.headers) {
                const isAllowed = options.decompress ? key !== 'content-encoding' : true;
                const value = response.headers[key];
                if (isAllowed) {
                    destination.setHeader(key, value);
                }
            }
            destination.statusCode = statusCode;
        }
    }
    async _onResponse(response) {
        try {
            await this._onResponseBase(response);
        }
        catch (error) {
            /* istanbul ignore next: better safe than sorry */
            this._beforeError(error);
        }
    }
    _onRequest(request) {
        const { options } = this;
        const { timeout, url } = options;
        source$3.default(request);
        this[kCancelTimeouts] = timed_out_1.default(request, timeout, url);
        const responseEventName = options.cache ? 'cacheableResponse' : 'response';
        request.once(responseEventName, (response) => {
            void this._onResponse(response);
        });
        request.once('error', (error) => {
            var _a;
            // Force clean-up, because some packages (e.g. nock) don't do this.
            request.destroy();
            // Node.js <= 12.18.2 mistakenly emits the response `end` first.
            (_a = request.res) === null || _a === void 0 ? void 0 : _a.removeAllListeners('end');
            error = error instanceof timed_out_1.TimeoutError ? new TimeoutError(error, this.timings, this) : new RequestError(error.message, error, this);
            this._beforeError(error);
        });
        this[kUnproxyEvents] = proxy_events_1.default(request, this, proxiedRequestEvents);
        this[kRequest] = request;
        this.emit('uploadProgress', this.uploadProgress);
        // Send body
        const body = this[kBody];
        const currentRequest = this.redirects.length === 0 ? this : request;
        if (is_1.default.nodeStream(body)) {
            body.pipe(currentRequest);
            body.once('error', (error) => {
                this._beforeError(new UploadError(error, this));
            });
        }
        else {
            this._unlockWrite();
            if (!is_1.default.undefined(body)) {
                this._writeRequest(body, undefined, () => { });
                currentRequest.end();
                this._lockWrite();
            }
            else if (this._cannotHaveBody || this._noPipe) {
                currentRequest.end();
                this._lockWrite();
            }
        }
        this.emit('request', request);
    }
    async _createCacheableRequest(url, options) {
        return new Promise((resolve, reject) => {
            // TODO: Remove `utils/url-to-options.ts` when `cacheable-request` is fixed
            Object.assign(options, url_to_options_1.default(url));
            // `http-cache-semantics` checks this
            // TODO: Fix this ignore.
            // @ts-expect-error
            delete options.url;
            let request;
            // This is ugly
            const cacheRequest = cacheableStore.get(options.cache)(options, async (response) => {
                // TODO: Fix `cacheable-response`
                response._readableState.autoDestroy = false;
                if (request) {
                    (await request).emit('cacheableResponse', response);
                }
                resolve(response);
            });
            // Restore options
            options.url = url;
            cacheRequest.once('error', reject);
            cacheRequest.once('request', async (requestOrPromise) => {
                request = requestOrPromise;
                resolve(request);
            });
        });
    }
    async _makeRequest() {
        var _a, _b, _c, _d, _e;
        const { options } = this;
        const { headers } = options;
        for (const key in headers) {
            if (is_1.default.undefined(headers[key])) {
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete headers[key];
            }
            else if (is_1.default.null_(headers[key])) {
                throw new TypeError(`Use \`undefined\` instead of \`null\` to delete the \`${key}\` header`);
            }
        }
        if (options.decompress && is_1.default.undefined(headers['accept-encoding'])) {
            headers['accept-encoding'] = supportsBrotli ? 'gzip, deflate, br' : 'gzip, deflate';
        }
        // Set cookies
        if (options.cookieJar) {
            const cookieString = await options.cookieJar.getCookieString(options.url.toString());
            if (is_1.default.nonEmptyString(cookieString)) {
                options.headers.cookie = cookieString;
            }
        }
        for (const hook of options.hooks.beforeRequest) {
            // eslint-disable-next-line no-await-in-loop
            const result = await hook(options);
            if (!is_1.default.undefined(result)) {
                // @ts-expect-error Skip the type mismatch to support abstract responses
                options.request = () => result;
                break;
            }
        }
        if (options.body && this[kBody] !== options.body) {
            this[kBody] = options.body;
        }
        const { agent, request, timeout, url } = options;
        if (options.dnsCache && !('lookup' in options)) {
            options.lookup = options.dnsCache.lookup;
        }
        // UNIX sockets
        if (url.hostname === 'unix') {
            const matches = /(?<socketPath>.+?):(?<path>.+)/.exec(`${url.pathname}${url.search}`);
            if (matches === null || matches === void 0 ? void 0 : matches.groups) {
                const { socketPath, path } = matches.groups;
                Object.assign(options, {
                    socketPath,
                    path,
                    host: ''
                });
            }
        }
        const isHttps = url.protocol === 'https:';
        // Fallback function
        let fallbackFn;
        if (options.http2) {
            fallbackFn = source$1.auto;
        }
        else {
            fallbackFn = isHttps ? https__default["default"].request : http__default["default"].request;
        }
        const realFn = (_a = options.request) !== null && _a !== void 0 ? _a : fallbackFn;
        // Cache support
        const fn = options.cache ? this._createCacheableRequest : realFn;
        // Pass an agent directly when HTTP2 is disabled
        if (agent && !options.http2) {
            options.agent = agent[isHttps ? 'https' : 'http'];
        }
        // Prepare plain HTTP request options
        options[kRequest] = realFn;
        delete options.request;
        // TODO: Fix this ignore.
        // @ts-expect-error
        delete options.timeout;
        const requestOptions = options;
        requestOptions.shared = (_b = options.cacheOptions) === null || _b === void 0 ? void 0 : _b.shared;
        requestOptions.cacheHeuristic = (_c = options.cacheOptions) === null || _c === void 0 ? void 0 : _c.cacheHeuristic;
        requestOptions.immutableMinTimeToLive = (_d = options.cacheOptions) === null || _d === void 0 ? void 0 : _d.immutableMinTimeToLive;
        requestOptions.ignoreCargoCult = (_e = options.cacheOptions) === null || _e === void 0 ? void 0 : _e.ignoreCargoCult;
        // If `dnsLookupIpVersion` is not present do not override `family`
        if (options.dnsLookupIpVersion !== undefined) {
            try {
                requestOptions.family = dns_ip_version_1.dnsLookupIpVersionToFamily(options.dnsLookupIpVersion);
            }
            catch (_f) {
                throw new Error('Invalid `dnsLookupIpVersion` option value');
            }
        }
        // HTTPS options remapping
        if (options.https) {
            if ('rejectUnauthorized' in options.https) {
                requestOptions.rejectUnauthorized = options.https.rejectUnauthorized;
            }
            if (options.https.checkServerIdentity) {
                requestOptions.checkServerIdentity = options.https.checkServerIdentity;
            }
            if (options.https.certificateAuthority) {
                requestOptions.ca = options.https.certificateAuthority;
            }
            if (options.https.certificate) {
                requestOptions.cert = options.https.certificate;
            }
            if (options.https.key) {
                requestOptions.key = options.https.key;
            }
            if (options.https.passphrase) {
                requestOptions.passphrase = options.https.passphrase;
            }
            if (options.https.pfx) {
                requestOptions.pfx = options.https.pfx;
            }
        }
        try {
            let requestOrResponse = await fn(url, requestOptions);
            if (is_1.default.undefined(requestOrResponse)) {
                requestOrResponse = fallbackFn(url, requestOptions);
            }
            // Restore options
            options.request = request;
            options.timeout = timeout;
            options.agent = agent;
            // HTTPS options restore
            if (options.https) {
                if ('rejectUnauthorized' in options.https) {
                    delete requestOptions.rejectUnauthorized;
                }
                if (options.https.checkServerIdentity) {
                    // @ts-expect-error - This one will be removed when we remove the alias.
                    delete requestOptions.checkServerIdentity;
                }
                if (options.https.certificateAuthority) {
                    delete requestOptions.ca;
                }
                if (options.https.certificate) {
                    delete requestOptions.cert;
                }
                if (options.https.key) {
                    delete requestOptions.key;
                }
                if (options.https.passphrase) {
                    delete requestOptions.passphrase;
                }
                if (options.https.pfx) {
                    delete requestOptions.pfx;
                }
            }
            if (isClientRequest(requestOrResponse)) {
                this._onRequest(requestOrResponse);
                // Emit the response after the stream has been ended
            }
            else if (this.writable) {
                this.once('finish', () => {
                    void this._onResponse(requestOrResponse);
                });
                this._unlockWrite();
                this.end();
                this._lockWrite();
            }
            else {
                void this._onResponse(requestOrResponse);
            }
        }
        catch (error) {
            if (error instanceof src.CacheError) {
                throw new CacheError(error, this);
            }
            throw new RequestError(error.message, error, this);
        }
    }
    async _error(error) {
        try {
            for (const hook of this.options.hooks.beforeError) {
                // eslint-disable-next-line no-await-in-loop
                error = await hook(error);
            }
        }
        catch (error_) {
            error = new RequestError(error_.message, error_, this);
        }
        this.destroy(error);
    }
    _beforeError(error) {
        if (this[kStopReading]) {
            return;
        }
        const { options } = this;
        const retryCount = this.retryCount + 1;
        this[kStopReading] = true;
        if (!(error instanceof RequestError)) {
            error = new RequestError(error.message, error, this);
        }
        const typedError = error;
        const { response } = typedError;
        void (async () => {
            if (response && !response.body) {
                response.setEncoding(this._readableState.encoding);
                try {
                    response.rawBody = await get_buffer_1.default(response);
                    response.body = response.rawBody.toString();
                }
                catch (_a) { }
            }
            if (this.listenerCount('retry') !== 0) {
                let backoff;
                try {
                    let retryAfter;
                    if (response && 'retry-after' in response.headers) {
                        retryAfter = Number(response.headers['retry-after']);
                        if (Number.isNaN(retryAfter)) {
                            retryAfter = Date.parse(response.headers['retry-after']) - Date.now();
                            if (retryAfter <= 0) {
                                retryAfter = 1;
                            }
                        }
                        else {
                            retryAfter *= 1000;
                        }
                    }
                    backoff = await options.retry.calculateDelay({
                        attemptCount: retryCount,
                        retryOptions: options.retry,
                        error: typedError,
                        retryAfter,
                        computedValue: calculate_retry_delay_1.default({
                            attemptCount: retryCount,
                            retryOptions: options.retry,
                            error: typedError,
                            retryAfter,
                            computedValue: 0
                        })
                    });
                }
                catch (error_) {
                    void this._error(new RequestError(error_.message, error_, this));
                    return;
                }
                if (backoff) {
                    const retry = async () => {
                        try {
                            for (const hook of this.options.hooks.beforeRetry) {
                                // eslint-disable-next-line no-await-in-loop
                                await hook(this.options, typedError, retryCount);
                            }
                        }
                        catch (error_) {
                            void this._error(new RequestError(error_.message, error, this));
                            return;
                        }
                        // Something forced us to abort the retry
                        if (this.destroyed) {
                            return;
                        }
                        this.destroy();
                        this.emit('retry', retryCount, error);
                    };
                    this[kRetryTimeout] = setTimeout(retry, backoff);
                    return;
                }
            }
            void this._error(typedError);
        })();
    }
    _read() {
        this[kTriggerRead] = true;
        const response = this[kResponse];
        if (response && !this[kStopReading]) {
            // We cannot put this in the `if` above
            // because `.read()` also triggers the `end` event
            if (response.readableLength) {
                this[kTriggerRead] = false;
            }
            let data;
            while ((data = response.read()) !== null) {
                this[kDownloadedSize] += data.length;
                this[kStartedReading] = true;
                const progress = this.downloadProgress;
                if (progress.percent < 1) {
                    this.emit('downloadProgress', progress);
                }
                this.push(data);
            }
        }
    }
    // Node.js 12 has incorrect types, so the encoding must be a string
    _write(chunk, encoding, callback) {
        const write = () => {
            this._writeRequest(chunk, encoding, callback);
        };
        if (this.requestInitialized) {
            write();
        }
        else {
            this[kJobs].push(write);
        }
    }
    _writeRequest(chunk, encoding, callback) {
        if (this[kRequest].destroyed) {
            // Probably the `ClientRequest` instance will throw
            return;
        }
        this._progressCallbacks.push(() => {
            this[kUploadedSize] += Buffer.byteLength(chunk, encoding);
            const progress = this.uploadProgress;
            if (progress.percent < 1) {
                this.emit('uploadProgress', progress);
            }
        });
        // TODO: What happens if it's from cache? Then this[kRequest] won't be defined.
        this[kRequest].write(chunk, encoding, (error) => {
            if (!error && this._progressCallbacks.length > 0) {
                this._progressCallbacks.shift()();
            }
            callback(error);
        });
    }
    _final(callback) {
        const endRequest = () => {
            // FIX: Node.js 10 calls the write callback AFTER the end callback!
            while (this._progressCallbacks.length !== 0) {
                this._progressCallbacks.shift()();
            }
            // We need to check if `this[kRequest]` is present,
            // because it isn't when we use cache.
            if (!(kRequest in this)) {
                callback();
                return;
            }
            if (this[kRequest].destroyed) {
                callback();
                return;
            }
            this[kRequest].end((error) => {
                if (!error) {
                    this[kBodySize] = this[kUploadedSize];
                    this.emit('uploadProgress', this.uploadProgress);
                    this[kRequest].emit('upload-complete');
                }
                callback(error);
            });
        };
        if (this.requestInitialized) {
            endRequest();
        }
        else {
            this[kJobs].push(endRequest);
        }
    }
    _destroy(error, callback) {
        var _a;
        this[kStopReading] = true;
        // Prevent further retries
        clearTimeout(this[kRetryTimeout]);
        if (kRequest in this) {
            this[kCancelTimeouts]();
            // TODO: Remove the next `if` when these get fixed:
            // - https://github.com/nodejs/node/issues/32851
            if (!((_a = this[kResponse]) === null || _a === void 0 ? void 0 : _a.complete)) {
                this[kRequest].destroy();
            }
        }
        if (error !== null && !is_1.default.undefined(error) && !(error instanceof RequestError)) {
            error = new RequestError(error.message, error, this);
        }
        callback(error);
    }
    get _isAboutToError() {
        return this[kStopReading];
    }
    /**
    The remote IP address.
    */
    get ip() {
        var _a;
        return (_a = this.socket) === null || _a === void 0 ? void 0 : _a.remoteAddress;
    }
    /**
    Indicates whether the request has been aborted or not.
    */
    get aborted() {
        var _a, _b, _c;
        return ((_b = (_a = this[kRequest]) === null || _a === void 0 ? void 0 : _a.destroyed) !== null && _b !== void 0 ? _b : this.destroyed) && !((_c = this[kOriginalResponse]) === null || _c === void 0 ? void 0 : _c.complete);
    }
    get socket() {
        var _a, _b;
        return (_b = (_a = this[kRequest]) === null || _a === void 0 ? void 0 : _a.socket) !== null && _b !== void 0 ? _b : undefined;
    }
    /**
    Progress event for downloading (receiving a response).
    */
    get downloadProgress() {
        let percent;
        if (this[kResponseSize]) {
            percent = this[kDownloadedSize] / this[kResponseSize];
        }
        else if (this[kResponseSize] === this[kDownloadedSize]) {
            percent = 1;
        }
        else {
            percent = 0;
        }
        return {
            percent,
            transferred: this[kDownloadedSize],
            total: this[kResponseSize]
        };
    }
    /**
    Progress event for uploading (sending a request).
    */
    get uploadProgress() {
        let percent;
        if (this[kBodySize]) {
            percent = this[kUploadedSize] / this[kBodySize];
        }
        else if (this[kBodySize] === this[kUploadedSize]) {
            percent = 1;
        }
        else {
            percent = 0;
        }
        return {
            percent,
            transferred: this[kUploadedSize],
            total: this[kBodySize]
        };
    }
    /**
    The object contains the following properties:

    - `start` - Time when the request started.
    - `socket` - Time when a socket was assigned to the request.
    - `lookup` - Time when the DNS lookup finished.
    - `connect` - Time when the socket successfully connected.
    - `secureConnect` - Time when the socket securely connected.
    - `upload` - Time when the request finished uploading.
    - `response` - Time when the request fired `response` event.
    - `end` - Time when the response fired `end` event.
    - `error` - Time when the request fired `error` event.
    - `abort` - Time when the request fired `abort` event.
    - `phases`
        - `wait` - `timings.socket - timings.start`
        - `dns` - `timings.lookup - timings.socket`
        - `tcp` - `timings.connect - timings.lookup`
        - `tls` - `timings.secureConnect - timings.connect`
        - `request` - `timings.upload - (timings.secureConnect || timings.connect)`
        - `firstByte` - `timings.response - timings.upload`
        - `download` - `timings.end - timings.response`
        - `total` - `(timings.end || timings.error || timings.abort) - timings.start`

    If something has not been measured yet, it will be `undefined`.

    __Note__: The time is a `number` representing the milliseconds elapsed since the UNIX epoch.
    */
    get timings() {
        var _a;
        return (_a = this[kRequest]) === null || _a === void 0 ? void 0 : _a.timings;
    }
    /**
    Whether the response was retrieved from the cache.
    */
    get isFromCache() {
        return this[kIsFromCache];
    }
    pipe(destination, options) {
        if (this[kStartedReading]) {
            throw new Error('Failed to pipe. The response has been emitted already.');
        }
        if (destination instanceof http_1.ServerResponse) {
            this[kServerResponsesPiped].add(destination);
        }
        return super.pipe(destination, options);
    }
    unpipe(destination) {
        if (destination instanceof http_1.ServerResponse) {
            this[kServerResponsesPiped].delete(destination);
        }
        super.unpipe(destination);
        return this;
    }
}
exports.default = Request;
});

var core_1 = core;

var types$1 = createCommonjsModule(function (module, exports) {
var __createBinding = (commonjsGlobal && commonjsGlobal.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (commonjsGlobal && commonjsGlobal.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CancelError = exports.ParseError = void 0;

/**
An error to be thrown when server response code is 2xx, and parsing body fails.
Includes a `response` property.
*/
class ParseError extends core_1.RequestError {
    constructor(error, response) {
        const { options } = response.request;
        super(`${error.message} in "${options.url.toString()}"`, error, response.request);
        this.name = 'ParseError';
    }
}
exports.ParseError = ParseError;
/**
An error to be thrown when the request is aborted with `.cancel()`.
*/
class CancelError extends core_1.RequestError {
    constructor(request) {
        super('Promise was canceled', {}, request);
        this.name = 'CancelError';
    }
    get isCanceled() {
        return true;
    }
}
exports.CancelError = CancelError;
__exportStar(core_1, exports);
});

var types_1 = types$1;

var parseBody_1 = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });

const parseBody = (response, responseType, parseJson, encoding) => {
    const { rawBody } = response;
    try {
        if (responseType === 'text') {
            return rawBody.toString(encoding);
        }
        if (responseType === 'json') {
            return rawBody.length === 0 ? '' : parseJson(rawBody.toString());
        }
        if (responseType === 'buffer') {
            return rawBody;
        }
        throw new types_1.ParseError({
            message: `Unknown body type '${responseType}'`,
            name: 'Error'
        }, response);
    }
    catch (error) {
        throw new types_1.ParseError(error, response);
    }
};
exports.default = parseBody;
});

var parse_body_1 = parseBody_1;

var asPromise_1 = createCommonjsModule(function (module, exports) {
var __createBinding = (commonjsGlobal && commonjsGlobal.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (commonjsGlobal && commonjsGlobal.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });









const proxiedRequestEvents = [
    'request',
    'response',
    'redirect',
    'uploadProgress',
    'downloadProgress'
];
function asPromise(normalizedOptions) {
    let globalRequest;
    let globalResponse;
    const emitter = new EventEmitter__default["default"].EventEmitter();
    const promise = new pCancelable((resolve, reject, onCancel) => {
        const makeRequest = (retryCount) => {
            const request = new core_1.default(undefined, normalizedOptions);
            request.retryCount = retryCount;
            request._noPipe = true;
            onCancel(() => request.destroy());
            onCancel.shouldReject = false;
            onCancel(() => reject(new types_1.CancelError(request)));
            globalRequest = request;
            request.once('response', async (response) => {
                var _a;
                response.retryCount = retryCount;
                if (response.request.aborted) {
                    // Canceled while downloading - will throw a `CancelError` or `TimeoutError` error
                    return;
                }
                // Download body
                let rawBody;
                try {
                    rawBody = await get_buffer_1.default(request);
                    response.rawBody = rawBody;
                }
                catch (_b) {
                    // The same error is caught below.
                    // See request.once('error')
                    return;
                }
                if (request._isAboutToError) {
                    return;
                }
                // Parse body
                const contentEncoding = ((_a = response.headers['content-encoding']) !== null && _a !== void 0 ? _a : '').toLowerCase();
                const isCompressed = ['gzip', 'deflate', 'br'].includes(contentEncoding);
                const { options } = request;
                if (isCompressed && !options.decompress) {
                    response.body = rawBody;
                }
                else {
                    try {
                        response.body = parse_body_1.default(response, options.responseType, options.parseJson, options.encoding);
                    }
                    catch (error) {
                        // Fallback to `utf8`
                        response.body = rawBody.toString();
                        if (is_response_ok_1.isResponseOk(response)) {
                            request._beforeError(error);
                            return;
                        }
                    }
                }
                try {
                    for (const [index, hook] of options.hooks.afterResponse.entries()) {
                        // @ts-expect-error TS doesn't notice that CancelableRequest is a Promise
                        // eslint-disable-next-line no-await-in-loop
                        response = await hook(response, async (updatedOptions) => {
                            const typedOptions = core_1.default.normalizeArguments(undefined, {
                                ...updatedOptions,
                                retry: {
                                    calculateDelay: () => 0
                                },
                                throwHttpErrors: false,
                                resolveBodyOnly: false
                            }, options);
                            // Remove any further hooks for that request, because we'll call them anyway.
                            // The loop continues. We don't want duplicates (asPromise recursion).
                            typedOptions.hooks.afterResponse = typedOptions.hooks.afterResponse.slice(0, index);
                            for (const hook of typedOptions.hooks.beforeRetry) {
                                // eslint-disable-next-line no-await-in-loop
                                await hook(typedOptions);
                            }
                            const promise = asPromise(typedOptions);
                            onCancel(() => {
                                promise.catch(() => { });
                                promise.cancel();
                            });
                            return promise;
                        });
                    }
                }
                catch (error) {
                    request._beforeError(new types_1.RequestError(error.message, error, request));
                    return;
                }
                if (!is_response_ok_1.isResponseOk(response)) {
                    request._beforeError(new types_1.HTTPError(response));
                    return;
                }
                globalResponse = response;
                resolve(request.options.resolveBodyOnly ? response.body : response);
            });
            const onError = (error) => {
                if (promise.isCanceled) {
                    return;
                }
                const { options } = request;
                if (error instanceof types_1.HTTPError && !options.throwHttpErrors) {
                    const { response } = error;
                    resolve(request.options.resolveBodyOnly ? response.body : response);
                    return;
                }
                reject(error);
            };
            request.once('error', onError);
            const previousBody = request.options.body;
            request.once('retry', (newRetryCount, error) => {
                var _a, _b;
                if (previousBody === ((_a = error.request) === null || _a === void 0 ? void 0 : _a.options.body) && is_1.default.nodeStream((_b = error.request) === null || _b === void 0 ? void 0 : _b.options.body)) {
                    onError(error);
                    return;
                }
                makeRequest(newRetryCount);
            });
            proxy_events_1.default(request, emitter, proxiedRequestEvents);
        };
        makeRequest(0);
    });
    promise.on = (event, fn) => {
        emitter.on(event, fn);
        return promise;
    };
    const shortcut = (responseType) => {
        const newPromise = (async () => {
            // Wait until downloading has ended
            await promise;
            const { options } = globalResponse.request;
            return parse_body_1.default(globalResponse, responseType, options.parseJson, options.encoding);
        })();
        Object.defineProperties(newPromise, Object.getOwnPropertyDescriptors(promise));
        return newPromise;
    };
    promise.json = () => {
        const { headers } = globalRequest.options;
        if (!globalRequest.writableFinished && headers.accept === undefined) {
            headers.accept = 'application/json';
        }
        return shortcut('json');
    };
    promise.buffer = () => shortcut('buffer');
    promise.text = () => shortcut('text');
    return promise;
}
exports.default = asPromise;
__exportStar(types_1, exports);
});

var createRejection_1 = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });

function createRejection(error, ...beforeErrorGroups) {
    const promise = (async () => {
        if (error instanceof types_1.RequestError) {
            try {
                for (const hooks of beforeErrorGroups) {
                    if (hooks) {
                        for (const hook of hooks) {
                            // eslint-disable-next-line no-await-in-loop
                            error = await hook(error);
                        }
                    }
                }
            }
            catch (error_) {
                error = error_;
            }
        }
        throw error;
    })();
    const returnPromise = () => promise;
    promise.json = returnPromise;
    promise.text = returnPromise;
    promise.buffer = returnPromise;
    promise.on = returnPromise;
    return promise;
}
exports.default = createRejection;
});

var deepFreeze_1 = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });

function deepFreeze(object) {
    for (const value of Object.values(object)) {
        if (is_1.default.plainObject(value) || is_1.default.array(value)) {
            deepFreeze(value);
        }
    }
    return Object.freeze(object);
}
exports.default = deepFreeze;
});

var types = createCommonjsModule(function (module, exports) {
Object.defineProperty(exports, "__esModule", { value: true });
});

var require$$0$1 = asPromise_1;

var create_rejection_1 = createRejection_1;

var deep_freeze_1 = deepFreeze_1;

var require$$0 = types;

var create_1$1 = createCommonjsModule(function (module, exports) {
var __createBinding = (commonjsGlobal && commonjsGlobal.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (commonjsGlobal && commonjsGlobal.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultHandler = void 0;





const errors = {
    RequestError: require$$0$1.RequestError,
    CacheError: require$$0$1.CacheError,
    ReadError: require$$0$1.ReadError,
    HTTPError: require$$0$1.HTTPError,
    MaxRedirectsError: require$$0$1.MaxRedirectsError,
    TimeoutError: require$$0$1.TimeoutError,
    ParseError: require$$0$1.ParseError,
    CancelError: require$$0$1.CancelError,
    UnsupportedProtocolError: require$$0$1.UnsupportedProtocolError,
    UploadError: require$$0$1.UploadError
};
// The `delay` package weighs 10KB (!)
const delay = async (ms) => new Promise(resolve => {
    setTimeout(resolve, ms);
});
const { normalizeArguments } = core_1.default;
const mergeOptions = (...sources) => {
    let mergedOptions;
    for (const source of sources) {
        mergedOptions = normalizeArguments(undefined, source, mergedOptions);
    }
    return mergedOptions;
};
const getPromiseOrStream = (options) => options.isStream ? new core_1.default(undefined, options) : require$$0$1.default(options);
const isGotInstance = (value) => ('defaults' in value && 'options' in value.defaults);
const aliases = [
    'get',
    'post',
    'put',
    'patch',
    'head',
    'delete'
];
exports.defaultHandler = (options, next) => next(options);
const callInitHooks = (hooks, options) => {
    if (hooks) {
        for (const hook of hooks) {
            hook(options);
        }
    }
};
const create = (defaults) => {
    // Proxy properties from next handlers
    defaults._rawHandlers = defaults.handlers;
    defaults.handlers = defaults.handlers.map(fn => ((options, next) => {
        // This will be assigned by assigning result
        let root;
        const result = fn(options, newOptions => {
            root = next(newOptions);
            return root;
        });
        if (result !== root && !options.isStream && root) {
            const typedResult = result;
            const { then: promiseThen, catch: promiseCatch, finally: promiseFianlly } = typedResult;
            Object.setPrototypeOf(typedResult, Object.getPrototypeOf(root));
            Object.defineProperties(typedResult, Object.getOwnPropertyDescriptors(root));
            // These should point to the new promise
            // eslint-disable-next-line promise/prefer-await-to-then
            typedResult.then = promiseThen;
            typedResult.catch = promiseCatch;
            typedResult.finally = promiseFianlly;
        }
        return result;
    }));
    // Got interface
    const got = ((url, options = {}, _defaults) => {
        var _a, _b;
        let iteration = 0;
        const iterateHandlers = (newOptions) => {
            return defaults.handlers[iteration++](newOptions, iteration === defaults.handlers.length ? getPromiseOrStream : iterateHandlers);
        };
        // TODO: Remove this in Got 12.
        if (is_1.default.plainObject(url)) {
            const mergedOptions = {
                ...url,
                ...options
            };
            core_1.setNonEnumerableProperties([url, options], mergedOptions);
            options = mergedOptions;
            url = undefined;
        }
        try {
            // Call `init` hooks
            let initHookError;
            try {
                callInitHooks(defaults.options.hooks.init, options);
                callInitHooks((_a = options.hooks) === null || _a === void 0 ? void 0 : _a.init, options);
            }
            catch (error) {
                initHookError = error;
            }
            // Normalize options & call handlers
            const normalizedOptions = normalizeArguments(url, options, _defaults !== null && _defaults !== void 0 ? _defaults : defaults.options);
            normalizedOptions[core_1.kIsNormalizedAlready] = true;
            if (initHookError) {
                throw new require$$0$1.RequestError(initHookError.message, initHookError, normalizedOptions);
            }
            return iterateHandlers(normalizedOptions);
        }
        catch (error) {
            if (options.isStream) {
                throw error;
            }
            else {
                return create_rejection_1.default(error, defaults.options.hooks.beforeError, (_b = options.hooks) === null || _b === void 0 ? void 0 : _b.beforeError);
            }
        }
    });
    got.extend = (...instancesOrOptions) => {
        const optionsArray = [defaults.options];
        let handlers = [...defaults._rawHandlers];
        let isMutableDefaults;
        for (const value of instancesOrOptions) {
            if (isGotInstance(value)) {
                optionsArray.push(value.defaults.options);
                handlers.push(...value.defaults._rawHandlers);
                isMutableDefaults = value.defaults.mutableDefaults;
            }
            else {
                optionsArray.push(value);
                if ('handlers' in value) {
                    handlers.push(...value.handlers);
                }
                isMutableDefaults = value.mutableDefaults;
            }
        }
        handlers = handlers.filter(handler => handler !== exports.defaultHandler);
        if (handlers.length === 0) {
            handlers.push(exports.defaultHandler);
        }
        return create({
            options: mergeOptions(...optionsArray),
            handlers,
            mutableDefaults: Boolean(isMutableDefaults)
        });
    };
    // Pagination
    const paginateEach = (async function* (url, options) {
        // TODO: Remove this `@ts-expect-error` when upgrading to TypeScript 4.
        // Error: Argument of type 'Merge<Options, PaginationOptions<T, R>> | undefined' is not assignable to parameter of type 'Options | undefined'.
        // @ts-expect-error
        let normalizedOptions = normalizeArguments(url, options, defaults.options);
        normalizedOptions.resolveBodyOnly = false;
        const pagination = normalizedOptions.pagination;
        if (!is_1.default.object(pagination)) {
            throw new TypeError('`options.pagination` must be implemented');
        }
        const all = [];
        let { countLimit } = pagination;
        let numberOfRequests = 0;
        while (numberOfRequests < pagination.requestLimit) {
            if (numberOfRequests !== 0) {
                // eslint-disable-next-line no-await-in-loop
                await delay(pagination.backoff);
            }
            // @ts-expect-error FIXME!
            // TODO: Throw when result is not an instance of Response
            // eslint-disable-next-line no-await-in-loop
            const result = (await got(undefined, undefined, normalizedOptions));
            // eslint-disable-next-line no-await-in-loop
            const parsed = await pagination.transform(result);
            const current = [];
            for (const item of parsed) {
                if (pagination.filter(item, all, current)) {
                    if (!pagination.shouldContinue(item, all, current)) {
                        return;
                    }
                    yield item;
                    if (pagination.stackAllItems) {
                        all.push(item);
                    }
                    current.push(item);
                    if (--countLimit <= 0) {
                        return;
                    }
                }
            }
            const optionsToMerge = pagination.paginate(result, all, current);
            if (optionsToMerge === false) {
                return;
            }
            if (optionsToMerge === result.request.options) {
                normalizedOptions = result.request.options;
            }
            else if (optionsToMerge !== undefined) {
                normalizedOptions = normalizeArguments(undefined, optionsToMerge, normalizedOptions);
            }
            numberOfRequests++;
        }
    });
    got.paginate = paginateEach;
    got.paginate.all = (async (url, options) => {
        const results = [];
        for await (const item of paginateEach(url, options)) {
            results.push(item);
        }
        return results;
    });
    // For those who like very descriptive names
    got.paginate.each = paginateEach;
    // Stream API
    got.stream = ((url, options) => got(url, { ...options, isStream: true }));
    // Shortcuts
    for (const method of aliases) {
        got[method] = ((url, options) => got(url, { ...options, method }));
        got.stream[method] = ((url, options) => {
            return got(url, { ...options, method, isStream: true });
        });
    }
    Object.assign(got, errors);
    Object.defineProperty(got, 'defaults', {
        value: defaults.mutableDefaults ? defaults : deep_freeze_1.default(defaults),
        writable: defaults.mutableDefaults,
        configurable: defaults.mutableDefaults,
        enumerable: true
    });
    got.mergeOptions = mergeOptions;
    return got;
};
exports.default = create;
__exportStar(require$$0, exports);
});

var create_1 = create_1$1;

var source = createCommonjsModule(function (module, exports) {
var __createBinding = (commonjsGlobal && commonjsGlobal.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (commonjsGlobal && commonjsGlobal.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });


const defaults = {
    options: {
        method: 'GET',
        retry: {
            limit: 2,
            methods: [
                'GET',
                'PUT',
                'HEAD',
                'DELETE',
                'OPTIONS',
                'TRACE'
            ],
            statusCodes: [
                408,
                413,
                429,
                500,
                502,
                503,
                504,
                521,
                522,
                524
            ],
            errorCodes: [
                'ETIMEDOUT',
                'ECONNRESET',
                'EADDRINUSE',
                'ECONNREFUSED',
                'EPIPE',
                'ENOTFOUND',
                'ENETUNREACH',
                'EAI_AGAIN'
            ],
            maxRetryAfter: undefined,
            calculateDelay: ({ computedValue }) => computedValue
        },
        timeout: {},
        headers: {
            'user-agent': 'got (https://github.com/sindresorhus/got)'
        },
        hooks: {
            init: [],
            beforeRequest: [],
            beforeRedirect: [],
            beforeRetry: [],
            beforeError: [],
            afterResponse: []
        },
        cache: undefined,
        dnsCache: undefined,
        decompress: true,
        throwHttpErrors: true,
        followRedirect: true,
        isStream: false,
        responseType: 'text',
        resolveBodyOnly: false,
        maxRedirects: 10,
        prefixUrl: '',
        methodRewriting: true,
        ignoreInvalidCookies: false,
        context: {},
        // TODO: Set this to `true` when Got 12 gets released
        http2: false,
        allowGetBody: false,
        https: undefined,
        pagination: {
            transform: (response) => {
                if (response.request.options.responseType === 'json') {
                    return response.body;
                }
                return JSON.parse(response.body);
            },
            paginate: response => {
                if (!Reflect.has(response.headers, 'link')) {
                    return false;
                }
                const items = response.headers.link.split(',');
                let next;
                for (const item of items) {
                    const parsed = item.split(';');
                    if (parsed[1].includes('next')) {
                        next = parsed[0].trimStart().trim();
                        next = next.slice(1, -1);
                        break;
                    }
                }
                if (next) {
                    const options = {
                        url: new url_1__default["default"].URL(next)
                    };
                    return options;
                }
                return false;
            },
            filter: () => true,
            shouldContinue: () => true,
            countLimit: Infinity,
            backoff: 0,
            requestLimit: 10000,
            stackAllItems: true
        },
        parseJson: (text) => JSON.parse(text),
        stringifyJson: (object) => JSON.stringify(object),
        cacheOptions: {}
    },
    handlers: [create_1.defaultHandler],
    mutableDefaults: false
};
const got = create_1.default(defaults);
exports.default = got;
// For CommonJS default export support
module.exports = got;
module.exports.default = got;
module.exports.__esModule = true; // Workaround for TS issue: https://github.com/sindresorhus/got/pull/1267
__exportStar(create_1, exports);
__exportStar(require$$0$1, exports);
});

var got = /*@__PURE__*/getDefaultExportFromCjs(source);

class SelfHostedScheduler extends NoteTweetScheduler {
    constructor(app, url, password) {
        super();
        this.app = app;
        this.url = url;
        this.password = password;
    }
    async deleteScheduledTweet(tweet) {
        await got.delete(`${this.url}/deleteScheduled`, {
            password: this.password,
            json: {
                tweet
            }
        });
        log.logMessage(`Unscheduled tweet: ${tweet.id}.`);
    }
    async getScheduledTweets() {
        const res = await got.get(`${this.url}/scheduledTweets`, {
            password: this.password
        });
        return JSON.parse(res.body);
    }
    async scheduleTweet(tweet) {
        const res = await got.post(`${this.url}/scheduleTweet`, {
            json: {
                tweet,
                postAt: tweet.postat
            },
            password: this.password
        });
        log.logMessage(`Schedule tweet: ${res.body}`);
        new obsidian.Notice(`Scheduled tweet '${tweet.content[0].substr(0, 10)}...' for ${window.moment(new Date(tweet.postat)).format("DD-MM-YY HH:mm")}`);
    }
    async updateTweet(newTweet) {
        const res = await got.post(`${this.url}/updateTweet`, {
            json: {
                tweet: newTweet,
                postAt: newTweet.postat
            },
            password: this.password
        });
        log.logMessage(`Update tweet: ${res.body}`);
    }
}

class NewTweetModal extends PostTweetModal {
    static PostTweet(app, selection) {
        const modal = new NewTweetModal(app, selection);
        modal.open();
        return modal.newTweet;
    }
    constructor(app, selection) {
        super(app, selection);
    }
    addActionButtons() {
        this.createTweetButton(this.contentEl);
        this.createScheduleButton(this.contentEl);
    }
    createTweetButton(contentEl) {
        let postButton = contentEl.createEl("button", { text: "Post!" });
        postButton.addClass("postTweetButton");
        postButton.addEventListener("click", this.postTweets());
    }
    createScheduleButton(contentEl) {
        const scheduleButton = contentEl.createEl('button', { text: 'Schedule' });
        scheduleButton.addClass("postTweetButton");
        scheduleButton.addEventListener('click', this.scheduleTweets());
    }
    postTweets() {
        return async () => {
            const threadContent = this.getThreadContent();
            if (!threadContent)
                return;
            const tweet = new Tweet(threadContent);
            this.resolve(tweet);
            this.close();
        };
    }
    scheduleTweets() {
        return async () => {
            const threadContent = this.getThreadContent();
            if (!threadContent)
                return;
            const scheduledDateTime = await promptForDateTime(this.app);
            const tweet = new ScheduledTweet(threadContent, scheduledDateTime);
            this.resolve(tweet);
            this.close();
        };
    }
}

const WELCOME_MESSAGE = "Loading NoteTweet🐦. Thanks for installing.";
const UNLOAD_MESSAGE = "Unloaded NoteTweet.";
class NoteTweet extends obsidian.Plugin {
    async onload() {
        console.log(WELCOME_MESSAGE);
        await this.loadSettings();
        this.twitterHandler = new TwitterHandler(this);
        this.connectToTwitterWithPlainSettings();
        this.addCommand({
            id: "post-selected-as-tweet",
            name: "Post Selected as Tweet",
            callback: async () => {
                if (this.twitterHandler.isConnectedToTwitter)
                    await this.postSelectedTweet();
                else if (this.settings.secureMode)
                    await this.secureModeProxy(async () => await this.postSelectedTweet());
                else {
                    this.connectToTwitterWithPlainSettings();
                    if (!this.twitterHandler.isConnectedToTwitter)
                        new TweetErrorModal(this.app, "Not connected to Twitter").open();
                    else
                        await this.postSelectedTweet();
                }
            },
        });
        this.addCommand({
            id: "post-file-as-thread",
            name: "Post File as Thread",
            callback: async () => {
                if (this.twitterHandler.isConnectedToTwitter)
                    await this.postThreadInFile();
                else if (this.settings.secureMode)
                    await this.secureModeProxy(async () => await this.postThreadInFile());
                else {
                    this.connectToTwitterWithPlainSettings();
                    if (!this.twitterHandler.isConnectedToTwitter)
                        new TweetErrorModal(this.app, "Not connected to Twitter").open();
                    else
                        await this.postThreadInFile();
                }
            },
        });
        this.addCommand({
            id: "post-tweet",
            name: "Post Tweet",
            callback: async () => {
                if (this.twitterHandler.isConnectedToTwitter)
                    await this.postTweetMode();
                else if (this.settings.secureMode)
                    await this.secureModeProxy(async () => await this.postTweetMode());
                else {
                    this.connectToTwitterWithPlainSettings();
                    if (!this.twitterHandler.isConnectedToTwitter)
                        new TweetErrorModal(this.app, "Not connected to Twitter").open();
                    else
                        await this.postTweetMode();
                }
            },
        });
        log.register(new ConsoleErrorLogger())
            .register(new GuiLogger(this));
        this.addSettingTab(new NoteTweetSettingsTab(this.app, this));
        if (this.settings.scheduling.enabled) {
            this.scheduler = new SelfHostedScheduler(this.app, this.settings.scheduling.url, this.settings.scheduling.password);
        }
    }
    async postTweetMode() {
        const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        let editor;
        if (view instanceof obsidian.MarkdownView) {
            editor = view.editor;
        }
        let tweet;
        if (editor === null || editor === void 0 ? void 0 : editor.somethingSelected()) {
            let text = editor.getSelection();
            try {
                text = this.parseThreadFromText(text).join("--nt_sep--");
                const selection = { text, thread: true };
                tweet = await NewTweetModal.PostTweet(this.app, selection);
            }
            catch (_a) {
                const selection = { text, thread: false };
                tweet = await NewTweetModal.PostTweet(this.app, selection);
            } // Intentionally suppressing exceptions. They're expected.
        }
        else {
            tweet = await NewTweetModal.PostTweet(this.app);
        }
        if (tweet instanceof ScheduledTweet) {
            await this.scheduler.scheduleTweet(tweet);
        }
        else if (tweet instanceof Tweet) {
            const tweetsPosted = await this.twitterHandler.postThread(tweet.content);
            new TweetsPostedModal(this.app, tweetsPosted, this.twitterHandler).open();
        }
    }
    connectToTwitterWithPlainSettings() {
        if (!this.settings.secureMode) {
            let { apiKey, apiSecret, accessToken, accessTokenSecret } = this.settings;
            if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret)
                return;
            this.twitterHandler.connectToTwitter(apiKey, apiSecret, accessToken, accessTokenSecret);
        }
    }
    async postThreadInFile() {
        const file = this.app.workspace.getActiveFile();
        let content = await this.getFileContent(file);
        let threadContent;
        try {
            threadContent = this.parseThreadFromText(content);
        }
        catch (e) {
            log.logError(`error in parsing thread in file ${file === null || file === void 0 ? void 0 : file.name}. ${e}`);
            return;
        }
        try {
            let postedTweets = await this.twitterHandler.postThread(threadContent);
            let postedModal = new TweetsPostedModal(this.app, postedTweets, this.twitterHandler);
            await postedModal.waitForClose;
            if (!postedModal.userDeletedTweets && this.settings.postTweetTag) {
                postedTweets.forEach((tweet) => this.appendPostTweetTag(tweet.data.text));
            }
        }
        catch (e) {
            log.logError(`failed attempted to post tweets. ${e}`);
        }
    }
    async postSelectedTweet() {
        const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        let editor;
        if (view instanceof obsidian.MarkdownView) {
            editor = view.editor;
        }
        else {
            return;
        }
        if (editor.somethingSelected()) {
            let selection = editor.getSelection();
            try {
                let tweet = await this.twitterHandler.postTweet(selection);
                let postedModal = new TweetsPostedModal(this.app, [tweet], this.twitterHandler);
                await postedModal.waitForClose;
                if (!postedModal.userDeletedTweets && this.settings.postTweetTag) {
                    await this.appendPostTweetTag(tweet.data.text);
                }
            }
            catch (e) {
                log.logError(`failed attempt to post selected. ${e}`);
            }
        }
        else {
            log.logWarning(`tried to post selected but nothing was selected.`);
        }
    }
    async secureModeProxy(callback) {
        if (!(this.settings.secureMode && !this.twitterHandler.isConnectedToTwitter))
            return;
        let modal = new SecureModeGetPasswordModal(this.app, this);
        modal.waitForClose
            .then(async () => {
            if (this.twitterHandler.isConnectedToTwitter)
                await callback();
            else
                log.logWarning("could not connect to Twitter");
        })
            .catch(() => {
            modal.close();
            log.logWarning("could not connect to Twitter.");
        });
    }
    onunload() {
        console.log(UNLOAD_MESSAGE);
    }
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }
    async saveSettings() {
        await this.saveData(this.settings);
    }
    async getFileContent(file) {
        if (file.extension != "md")
            return null;
        return await this.app.vault.read(file);
    }
    // All threads start with THREAD START and ends with THREAD END. To separate tweets in a thread,
    // one should use use a newline and '---' (this prevents markdown from believing the above tweet is a heading).
    // We also purposefully remove the newline after the separator - otherwise tweets will be posted with a newline
    // as their first line.
    parseThreadFromText(text) {
        let contentArray = text.split("\n");
        let threadStartIndex = contentArray.indexOf("THREAD START") + 1;
        let threadEndIndex = contentArray.indexOf("THREAD END");
        if (threadStartIndex == 0 || threadEndIndex == -1) {
            throw new Error("Failed to detect THREAD START or THREAD END");
        }
        let content = contentArray
            .slice(threadStartIndex, threadEndIndex)
            .join("\n")
            .split("\n---\n");
        if (content.length == 1 && content[0] == "") {
            throw new Error("Please write something in your thread.");
        }
        return content.map((txt) => txt.trim());
    }
    async appendPostTweetTag(selection) {
        const currentFile = this.app.workspace.getActiveFile();
        let pageContent = await this.getFileContent(currentFile);
        pageContent = pageContent.replace(selection.trim(), `${selection.trim()} ${this.settings.postTweetTag}`);
        await this.app.vault.modify(currentFile, pageContent);
    }
}

module.exports = NoteTweet;
