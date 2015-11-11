/**
 * Communication api
 */

/**
 * Create a new communication link to Zimbra
 *
 * See options/communication.js
 *
 * @param options Options object validated against ConstructorOptions
 * @constructor
 */

var communicationOptions = require('./options/communication'),
    communicationErrors = require('../errors/communication'),
    commonErrors = require('../errors/common'),
    requestApi = require('./request'),
    preauthUtil = require('../utils/preauth'),
    restler = require('restler'),
    util = require('util');

function CommunicationApi(options) {

    // Sanitize option eventually throwing an InvalidOption

    this.options = new communicationOptions.constructor(options);

    if (this.options.get("token") !== "") {

        this.token = this.options.get("token");

    } else {

        this.token = null;

    }

}

/**
 * Handle the response from sending the auth request
 *
 * @param callback Callback from auth()
 * @param err Optional errors by send()
 * @param response The response
 * @private
 */

CommunicationApi.prototype._handleAuthResponse = function (
    callback, err, response
) {

    if (err) {

        callback(err);
        return;

    }

    if (!response.hasOwnProperty("AuthResponse")) {

        callback(
            commonErrors.systemError(
                "Didn't find AuthResponse in response: {{message}} ",
                {
                    message: util.inspect(response, false, null)
                }
            )
        );
        return;

    }

    // Set the auth token

    this.token = response.AuthResponse.authToken[0]._content;

    // We're through. Call the callback.

    callback(null);

};

/**
 * Handle the generated secret (preauth key or password), build up the
 * auth request and send it
 *
 * @param options Options from auth()
 * @param callback Callback from auth()
 * @param err Optional errors from the call
 * @param secret Generated secret (preauth key or password)
 * @private
 */

CommunicationApi.prototype._authSecret = function(
    options, callback, err, secret
) {

    var that = this;

    if (err) {

        callback(err);
        return;

    }

    this.getRequest(
        {
            noAuth:true
        },
        function (err, request) {

            if (err) {

                callback(err);
                return;

            }

            var requestParams = {
                account: {
                    by: "name",
                    _content: options.username
                }
            };

            var ns = "zimbraAccount";

            if (options.isAdmin) {

                ns = "zimbraAdmin";
                requestParams.password = secret;

            } else if (options.isPassword) {

                requestParams.password = {
                    _content: secret
                };

            } else {

                requestParams.preauth = {
                    timestamp: requestParams.timestamp,
                    expires: 0,
                    _content: secret
                };

            }

            request.addRequest(
                {
                    name: "AuthRequest",
                    params: requestParams,
                    namespace: ns
                },
                function (err, request) {

                    if (err) {

                        callback(err);
                        return;

                    }

                    // Send out request

                    that.send(
                        request,
                        that._handleAuthResponse.bind(that, callback)
                    );

                }
            );

        }
    );

};

/**
 * Authenticate against Zimbra.
 *
 * @param options see communicationOptions.auth
 * @param callback Error?
 */

CommunicationApi.prototype.auth = function(options, callback) {

    try {

        options = new communicationOptions.auth(options);

    } catch (err) {

        if (err.name === 'InvalidOption') {

            callback(
                commonErrors.invalidOption(
                    undefined,
                    {
                        message: err.message
                    }
                )
            );

        } else {

            callback(
                commonErrors.systemError(
                    undefined,
                    {
                        message: err.message
                    }
                )
            );

        }

        return;

    }

    var isPassword = options.get("isPassword");

    if (options.get("isAdmin")) {

        isPassword = true;

    }

    var requestOptions = options.list();

    requestOptions.isPassword = isPassword;
    requestOptions.timestamp = new Date().getTime();

    if (!isPassword) {

        preauthUtil.createPreauth(
            {
                byValue: options.get("username"),
                key: options.get("secret"),
                timestamp: requestOptions.timestamp
            },
            this._authSecret.bind(this, requestOptions, callback)
        );

    } else {

        this._authSecret(requestOptions, callback, null, options.get("secret"));

    }

};

/**
 * Get a prebuilt request with an auth token.
 *
 * @param options Options object validated against GetRequestOptions
 * @param callback Error?, Request-Object
 */

CommunicationApi.prototype.getRequest = function(options, callback) {

    // Check options

    try {

        options = new communicationOptions.getRequest(options);

    } catch (err) {

        if (err.name === 'InvalidOption') {

            callback(
                commonErrors.invalidOption(
                    undefined,
                    {
                        message: err.message
                    }
                )
            );

        } else {

            callback(
                commonErrors.systemError(
                    {
                        message: err.message
                    }
                )
            );

        }

        return;

    }

    if (!this.token && !options.get("noAuth")) {

        callback(communicationErrors.noToken());
        return;

    }

    // Build request

    var requestOptions = {
        isBatch: options.get("isBatch"),
        batchOnError: options.get("batchOnError"),
        context: options.get("context")
    };

    if (this.token) {

        requestOptions.token = this.token;

    }

    var request;

    try {

        request = new requestApi(requestOptions);

    } catch (err) {

        if (err.name === 'InvalidOption') {

            callback(
                commonErrors.invalidOption(
                    undefined,
                    {
                        message: err.message
                    }
                )
            );

        } else {

            callback(
                commonErrors.systemError(
                    undefined,
                    {
                        message: err.message
                    }
                )
            );

        }

        return;

    }

    callback(null, request);

};

/**
 * Send a request to the Zimbra server and pass a response to the callback
 *
 * @param request The premade request
 * @param callback Error?,Response
 */

CommunicationApi.prototype.send = function (request, callback) {

    var that = this;

    request.getRequest(function (err, request) {

        if (err) {

            callback(err);
            return;

        }

        restler.postJson(
            that.options.get("url"),
            request,
            {
                parser: restler.parsers.json
            }
        )
            .on("success", function(data) {

                if (!data.hasOwnProperty("Body")) {

                    callback(
                        commonErrors.systemError(
                            "Didn't understand non-faulty response:" +
                            " {{message}}",
                            {
                                message: util.inspect(data, false, null)
                            }
                        )
                    );

                } else {

                    callback(null, data.Body);

                }
            })
            .on("fail", function(data) {

                if (
                    data.hasOwnProperty("Body") &&
                    data.Body.hasOwnProperty("Fault")
                ) {

                    var code = "",
                        reason = "",
                        detail = "";

                    if (
                        data.Body.Fault.hasOwnProperty("Code") &&
                        data.Body.Fault.Code.hasOwnProperty("Value")
                    ) {

                        code = data.Body.Fault.Code.Value;

                    }

                    if (
                        data.Body.Fault.hasOwnProperty("Detail")
                    ) {

                        detail = util.inspect(
                            data.Body.Fault.Detail,
                            false,
                            null
                        );

                    }

                    if (
                        data.Body.Fault.hasOwnProperty("Reason") &&
                        data.Body.Fault.Code.hasOwnProperty("Text")
                    ) {

                        reason = data.Body.Fault.Reason.Text;

                    }

                    callback(
                        communicationErrors.zimbraError(
                            undefined,
                            {
                                code: code,
                                detail: detail,
                                reason: reason
                            }
                        )
                    );

                } else {

                    callback(
                        commonErrors.systemError(
                            "Didn't understand faulty response: {{message}}",
                            {
                                message: util.inspect(data, false, null)
                            }
                        )
                    );

                }

            })
            .on("error", function(err) {
                callback(err);
            });

    });

};

module.exports = CommunicationApi;