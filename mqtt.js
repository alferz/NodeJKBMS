const cli = require('./cli');
const mqtt = require('async-mqtt');
const logger = require('./logger');
const args = cli.args;

const mqttOptions = {
    username: args.mqttuser,
    password: args.mqttpass,
    clientId: `nodeJKBMS_${Math.random().toString(16).substr(2,8)}`    
};

module.exports = {
    publish: async function(packData, cellData) {
        try {
            logger.trace('Connecting to MQTT broker...');
            const client = await mqtt.connectAsync(`tcp://${args.mqttbroker}`, mqttOptions)
            await client.publish(`${args.mqtttopic}/pack`, JSON.stringify(packData));
            await client.publish(`${args.mqtttopic}/cells`, JSON.stringify(cellData));
            await client.end();
			logger.trace('Data sent to MQTT broker...');
        } catch (e){
            logger.error(e);
        }
    }
}
