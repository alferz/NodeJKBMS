# NodeJKBMS

Utility to retrieve data from JK (JiKong/Heltec/Hankzor) BMS units and publish it to MQTT, written in NodeJS.

Data can then be polled/displayed in Node-RED, Home Assistant, or anything else that can read from a MQTT bus.

**NOTE:** This software provides *read-only* access to your BMS, intended for publshing information to Node-Red, Home Assistant, Grafana, or similar. You can not change any BMS parameters with this software. Additionally current JKBMS units do not support writing most parameters using the GPS/TTL/RS-485 port at manufacturer discretion.

This software is licensed under the [MIT License](https://opensource.org/licenses/MIT).

## Thanks

Sophie Wheeler (@sophienyaa) for her excellent [NodeJBD](https://github.com/sophienyaa/NodeJBD) project on which this software is based and forked. 

Eric Poulsen for his [bms-tools](https://gitlab.com/bms-tools/bms-tools/-/tree/master) and [documation](https://gitlab.com/bms-tools/bms-tools/-/blob/master/JBD_REGISTER_MAP.md).

Overkill Solar for their [extensive docuentation](https://overkillsolar.com/support-downloads/) and [Arduino library](https://github.com/FurTrader/Overkill-Solar-BMS-Arduino-Library).

## Compatibility

See below table, in theory this should work with any current JK BMS, but the below have been tested.
If you have success with one not listed here, please let me know by sending a message or submitting an issue!

|BMS Model|Interface|HW Version|Notes|Status|
|----------|---------|-----|------|------|
|JK B2A8S20P|GPS (TTL or RSS-485)|v11+|200A 8s 2A Active Balance BMS|✅|


## Compatibility Notes

The JK BMS uses a 4-pin GPS port to communicate. Earlier versions (prior to hardware version 11) may have a different configuration, let me know if you have an earlier version that works the same way. The GPS port natively supports the TTL serial communication protocol at 115200 baud rate, and therefore a USB-TTL adapter is often the simplest way to communicate with the BMS. JK/Heltec/Hankzor also sell an "RS-485" adapter, which appears to convert the TTL output on the GPS port to RS-485 -- this configuration is currently untested, again please let me know if you are able to use this software with RS-485. 

## Compatibility with Node-JBD

This fork of Node-JBD was created with MQTT compatibility for existing applications that rely on Node-JBD to supply data over the MQTT message queue. As a result every effort was made to match Node-JBD's parameter naming wherever possible. If you find a compatibility problem please submit an issue.


## Supported BMS Read Parameters 

This software implements the protocol released by JiKong/NEEY and currently stored at diysolarforum.com in the [resources section](https://diysolarforum.com/resources/jk-bms-documentation-on-protocols-provided-by-hankzor.259/). This software supports reading many of the parameters specified in the protocol document and displaying them to console or publishing them to MQTT. Despite what is written in the protocol document, the JK BMS does not currently support writing paramaters such as under-voltage protection and similar settings, and writing any parameter is not supported by this software. 

## Connecting your BMS

The JK BMS uses a 4-pin GPS port for communication. This port natively uses the TTL serial communication protocol at 115200 baud rate. The pinout is shown below. Note that the vout PIN is supplying full pack voltage (ie, 27v or 52v) which will easily destroy your USB-TTL adapter. It is likely not needed anyway so I recommend not connecting vout to anything. Your USB-TTL adapter should be powered by the USB port and wont need another voltage source.

You will need to connect RXD, TXD and GND to your USB-TTL device in order for it to work. If you use the JiKong provided TTL to RS-485 adapter, you will then need a generic USB to RS-485 adapter as well which typically runs at 9600 baud (you will need to use the --baudrate option). Using a USB-TTL adapter means you only need one adapter and is probably the preferred communication method.  

<pre>
<--------TOP OF BMS ---------->    
<TEMP port>    <3-pin port>    <GPS Port>
                               < o o o o >
                                 | | | |
                                /  | | \--- GND
                vout (28v!)----/   | |         
                                  /   \---  TXD (3.3v)
                     RXD (3.3v)--/
</pre>

## Using the utility

Ideally you would install/run this on a device that is connected to your BMS all the time. I use a Raspberry Pi 4, which is more than powerful enough for this use case. 

This also assumes you have a MQTT broker setup and running already. If you don't want to use MQTT you can output the results to the console. Support for other output methods may come at a later date.

You will first need to ensure you have NodeJS v16+ installed on your device.

The Pi Zero/One doesn't have official support for newer version of NodeJS, so follow the instructions [here](https://hassancorrigan.com/blog/install-nodejs-on-a-raspberry-pi-zero/) to get it installed.

If you are using a Pi 2 or later, follow the instructions [here](https://lindevs.com/install-node-js-and-npm-on-raspberry-pi/) to install the official NodeSource build.

Once you've got NodeJS installed, then follow the below instructions.

### Installation

1. Clone this repository (or download it) by running;

`git clone https://github.com/alferz/NodeJKBMS.git`

2. Change to the `NodeJKBMS` directory and install the dependencies by running the below commands

 - Change to the directory you cloned the code into: `cd NodeJKBMS`
 - Run installer: `npm install` 
 - Link command: `sudo npm link`

### Running the utility

Basic Example:

`node-jkbms -s /dev/ttyUSB0 -m 192.168.0.10`

This would use serial port `/dev/ttyUSB0` and connect to MQTT Broker at `192.168.0.10` with no user/password, publishing to the `NodeJKBMS/pack` and `NodeJKBMS/cells` topics every 10s.

The utility supports using different polling intervals and topics, as well as MQTT brokers that need authentication, please see below for a full list of options.

These options can also be passed as environment variables, by appending `NODEJKBMS_` to the argument (e.g. `NODEJKBMS_SERIALPORT=/dev/ttyUSB0`). This is useful when running as a service (see below section).

|Argument |Alias |Env Var|Description | Example |
|---------|------|----------|-----|----|
|--serialport|-s|NODEJKBMS_SERIALPORT|REQUIRED: Serial port your BMS is connected to|-s /dev/ttyUSB0|
|--baudrate|-b|NODEJKBMS_BAUDRATE|The baud rate to use for serial communications, defaults to 115200|-b 9600|
|--mqttbroker|-m|NODEJKBMS_MQTTBROKER|The address of your MQTT Broker|-m 192.168.0.10|
|--mqttuser|-u|NODEJKBMS_MQTTUSER|The username for your MQTT Broker|-u mqttUser|
|--mqttpass|-p|NODEJKBMS_MQTTPASS|The password for your MQTT Broker|-p mqttPass| 
|--mqtttopic|-t|NODEJKBMS_MQTTTOPIC|MQTT topic to publish to defaults to 'NodeJKBMS'|-t MyTopic|
|--pollinginterval|-i|NODEJKBMS_POLLINGINTERVAL|How frequently to poll the controller in seconds, defaults to 10|-i 60|
|--loglevel|-l|NODEJKBMS_LOGLEVEL|Sets the logging level, useful for debugging|-l trace|   
|--help|-h||Show help ||
|--version|||Show version number|  |    

### Running as a service

The utility can be configured to run as a service, including on startup.

These instructions are for Rasbpbian, but should work on any Debian based distro (Ubuntu, etc) or any system that uses systemd.

1. Create a service definition file. This file should contain your required environment variables.

Example:
```
[Unit]
Description=NodeJKBMS Service

[Service]
ExecStart=node-jkbms
Restart=always
User=pi
Group=pi
Environment=PATH=/usr/bin:/usr/local/bin
Environment=NODE_ENV=production
Environment=NODEJBD_SERIALPORT=/dev/ttyUSB0
Environment=NODEJBD_MQTTBROKER=192.168.0.10
WorkingDirectory=/home/pi/NodeJKBMS

[Install]
WantedBy=multi-user.target
```
Note the `Environment=...` lines, set any configuration options here such as serial port, MQTT broker, interval, etc.

2. Name this file `nodejkbms.service` and save it in `/etc/systemd/system`

3. Run the following commands:

 - To start the service: `systemctl start nodejkbms`

 - To check the logs/ensure its running: `journalctl -u nodejkbms`

 - To enable the service to run at startup: `systemctl enable nodejkbms`

## Publishing to MQTT

The utility will publish one topic, with two subtopics on your MQTT Broker. You specify the topic name in the configuration with the default being `NodeJKBMS`

The first subtopic is `<topic>/pack`. This is published at the set interval and contains all the information about your pack. 

Example:
```json
{
	"packV": "13.30",
	"packA": "-0.43",
	"packBalCap": "96.04",
	"packRateCap": "100.00",
	"packCycles": 0,
	"packNumberOfCells": 4,
	"balanceStatus": [{
		"cell0": false
	}, {
		"cell1": false
	}, {
		"cell2": false
	}, {
		"cell3": false
	}],
	"balanceStatusHigh": [{
		"cell0": false
	}, {
		"cell1": false
	}, {
		"cell2": false
	}, {
		"cell3": false
	}],
	"protectionStatus": {
		"singleCellOvervolt": false,
		"singleCellUndervolt": false,
		"packOvervolt": false,
		"packUndervolt": false,
		"chargeOvertemp": false,
		"chargeUndertemp": false,
		"dischargeOvertemp": false,
		"dischargeUndertemp": false,
		"chargeOvercurrent": false,
		"dischargeOvercurrent": false,
		"shortCircut": false,
		"frontEndDetectionICError": false,
		"softwareLockMOS": false
	},
	"bmsSWVersion": 32,
	"packSOC": 96,
	"FETStatus": {
		"charging": true,
		"discharging": true
	},
	"tempSensorCount": 3,
	"tempSensorValues": {
		"NTC0": "12.85",
		"NTC1": "13.95",
		"NTC2": "13.55"
	}
}
```

The second is `<topic>/cells` This is published at the set interval and contains the voltages of your individual cells. 

Example:
```json
{
    "cell0mV":3324,
    "cell0V":3.32,
    "cell1mV":3325,
    "cell1V":3.33,
    "cell2mV":3324,
    "cell2V":3.32,
    "cell3mV":3325,
    "cell3V":3.33,
	"cell4mV":3323,
    "cell4V":3.32,
    "cell5mV":3326,
    "cell5V":3.33,
    "cell6mV":3324,
    "cell6V":3.32,
    "cell7mV":3325,
    "cell7V":3.33
}
```
You can then subscribe the topics with a MQTT client and data as you wish. An example of this would be surfacing it in Home Assistant or a custom Node-RED application. 
