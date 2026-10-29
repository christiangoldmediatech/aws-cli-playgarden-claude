var mysql = require('mysql');

const NOT_APPLICABLE_PROPERTIES = [
    'mp4Outputs',
    'mp4Urls',
    'hlsPlaylist',
    'hlsUrl',
    'dashPlaylist',
    'dashUrl',
    'mssPlaylist',
    'mssUrl',
    'cmafDashPlaylist',
    'cmafDashUrl',
    'cmafHlsPlaylist',
    'cmafHlsUrl'
];

exports.handler = async(event) => {
    let msg = {};
    let subject = 'Workflow Status:: ' + event.workflowStatus + ':: ' + event.guid;

    if (event.workflowStatus === 'Complete') {
        msg = event;
        delete msg.srcMediainfo;
        delete msg.jobTemplate_2160p;
        delete msg.jobTemplate_1080p;
        delete msg.jobTemplate_720p;
        delete msg.encodingJob;
        delete msg.encodingOutput;

        if (event.enableMediaPackage) {
            /*
                If MediaPackage VOD is enabled, some properties can be removed from the final output.
                They're still saved in DynamoDB, but are not included in the notification.
            */
            NOT_APPLICABLE_PROPERTIES.forEach(prop => delete msg[prop]);
        }
    }

    // console.log(`EVENT:: ${JSON.stringify(event, null, 2)}`);
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        const data = await new Promise((resolve, reject) => {
            connection.connect(function(err) {
                if (err) {
                    reject(err);
                }

                connection.query(`SELECT * FROM videos WHERE src_video = '${event.srcVideo}'`, async function(err, result) {
                    if (err) {
                        console.log("Error->" + err);
                        reject(err);
                    }

                    if (result) {
                        for (const row of result) {
                            await new Promise((resolve, reject) => {
                                connection.query(`UPDATE videos SET status = 'COMPLETED', video_url = '${JSON.stringify(event.egressEndpoints)}' WHERE id = ${row.id}`, function(err, result) {
                                    if (err) {
                                        console.log("Error->" + err);
                                        reject(err);
                                    }

                                    resolve(result)
                                })
                            })
                        }
                    }

                    resolve(result);
                });
            })
        });
    } catch (err) {
        console.log({
            statusCode: 400,
            body: err.message
        })
    }

    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME2
        });

        const data = await new Promise((resolve, reject) => {
            connection.connect(function(err) {
                if (err) {
                    reject(err);
                }
                connection.query(`SELECT * FROM videos WHERE src_video = '${event.srcVideo}'`, async function(err, result) {
                    if (err) {
                        console.log("Error->" + err);
                        reject(err);
                    }

                    if (result) {
                        for (const row of result) {
                            await new Promise((resolve, reject) => {
                                connection.query(`UPDATE videos SET status = 'COMPLETED', video_url = '${JSON.stringify(event.egressEndpoints)}' WHERE id = ${row.id}`, function(err, result) {
                                    if (err) {
                                        console.log("Error->" + err);
                                        reject(err);
                                    }

                                    resolve(result)
                                })
                            })
                        }
                    }
                    resolve(result);
                });
            })
        });
    } catch (err) {
        console.log({
            statusCode: 400,
            body: err.message
        })
    }
};