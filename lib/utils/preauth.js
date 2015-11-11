/**
 * Preauthkey-calculation
 */

var preauthOptions = require('./options/preauth'),
    commonErrors = require('../errors/common'),
    crypto = require('crypto'),
    util = require('util');

module.exports = {

    /**
     * Create a preauth value
     *
     * @param options see CreatePreauthOptions
     * @param callback
     */

    createPreauth: function(options, callback) {

        try {

            options = preauthOptions.createPreauth(options);

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

        var timestamp = options.get("timestamp");

        if (!timestamp) {

            timestamp = new Date().getTime();

        }

        var pak = crypto.createHmac("sha1", options.get("key"))
            .setEncoding("hex")
            .write(
                util.format(
                    "%s|%s|%s|%s",
                    options.get("byValue"),
                    options.get("by"),
                    options.get("expires"),
                    timestamp
                )
            )
            .end()
            .read();

        callback(null, pak);

    }

};