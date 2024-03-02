const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { ByteLengthParser } = require('@serialport/parser-byte-length')
const { DelimiterParser } = require('@serialport/parser-delimiter')
const { ReadyParser } = require('@serialport/parser-ready')
const { PacketLengthParser } = require('@serialport/parser-packet-length')
const { InterByteTimeoutParser } = require('@serialport/parser-inter-byte-timeout')
// const Delimiter = require('@serialport/parser-delimiter')
const logger = require('./logger');
const cli = require('./cli');
const mqtt = require('./mqtt');
const args = cli.args;

const START_BYTE = 0xDD;
const STOP_BYTE = 0x77;
const READ_BYTE = 0xA5;
const READ_LENGTH = 0x00;


const readCommand = { 							//See JKBMS protocol spec for the parameters and format of this command
	'START_BYTES': 		[0x4E, 0x57], 			//From JKBMS Protocol Spec
	'LENGTH': 			[0x00,0x13], 			//Length of this packet, not including the start bytes but including the 4 byte checksum after END_BYTE. This packet will have length of 19 (0x13 hex)
	'TERMINAL_NUMBER': 	[0x00,0x00,0x00,0x00], 	//An optional terminal number
	'COMMAND':			[0x06], 				//0x06 is the 'readall' command
	'FRAME_SOURCE': 	[0x03], 				//0x03 is host computer
	'TRANSPORT_TYPE':	[0x00], 				//0x00 is a read command 
	'REGISTER':			[0x00], 				//0x00 for the 0x06 'readall' command
	'RECORD_NUMBER':	[0x00,0x00,0x00,0x00], 	//optional record number
	'END_BYTE':			[0x68] 					//From the protocol spec
}

let iterationCounter = 0;
let numErrors = 0;
let startedAt = Date.now();

let readPacket = Object.values(readCommand).flat(); //Flatten the arrays from readCommand

//need to add the 'crc', which is really just a sum of the data so far
let decSum = readPacket.reduce((e1,e2) => e1+e2); //Reduce the values in readPacket by summing each individual byte, this will be a decimal
let sumBuffer = Buffer.alloc(4); //allocate a 4 byte buffer for the sum
sumBuffer.writeUInt32BE(decSum,0) //Write the decimal to the sumBuffer in 4 bytes

//Build the packet to be written to the serial port
let readAllBuffer = Buffer.concat([Buffer.from(readPacket), sumBuffer]); //Add the 4 byte crc to the end of the readPacket


//offset is relative to start of restOfData -- 0x00 is where register 0x80 should be
const supportedMeasurements = {
	packV: 				{offset: 0x09, register: 0x83, dataLength: 2, dataType: 'unsignedFloat'},
	packA: 				{offset: 0x0C, register: 0x84, dataLength: 2, dataType: 'signedFloat'},
	//packBalCap:  JKBMD does not report this value explicitly, but it may be calculated from packRateCap and packSOC in parsePackData()
	packRateCap: 		{offset: 0xBD, register: 0xB9, dataLength: 4, dataType: 'unsignedInt'},
	packCycleCap: 		{offset: 0x16, register: 0x89, dataLength: 4, dataType: 'unsignedInt'},
	packNumberOfCells:	{offset: 0x1B, register: 0x8a, dataLength: 2, dataType: 'unsignedInt'},
	//balanceStatus - As of v11, JKBMS GPS protocol does not support balancer status by cell like the JBD does :(
	//balanceStatusHigh - Also not supported
	protectionStatus:	{offset: 0x1E, register: 0x8b, dataLength: 2, dataType: 'protectionStatus'},
	packNumberCycles:	{offset: 0x13, register: 0x87, dataLength: 2, dataType: 'unsignedInt'},
	tempSensorCount:	{offset: 0x11, register: 0x86, dataLength: 1, dataType: 'unsignedInt'},
	tempSensorValues:	{offset: 0x00, register: 0x80, dataLength: 8, dataType: 'tempSensor'}, //Assumes 3 sensors
	bmsSWVersion:		{offset: 0xAB, register: 0xB7, dataLength: 15, dataType: 'ascii'}, 
	packSOC:	 		{offset: 0x0F, register: 0x85, dataLength: 1, dataType: 'unsignedInt'},
	FETStatus:	 		{offset: 0x21, register: 0x8c, dataLength: 2, dataType: 'bmsStatus'},
	balancerSwitch:		{offset: 0x51, register: 0x9d, dataLength: 1, dataType: 'unsignedInt'},
	bmsOnMinutes:		{offset: 0xA6, register: 0xB6, dataLength: 4, dataType: 'unsignedInt'},
	userData:			{offset: 0xC2, register: 0xBA, dataLength: 26, dataType: 'ascii'}
};

function convertData(dataType, rawValue){
	function isSet(number, bitpos){
		return (number & (1 << bitpos)) === 0 ? false : true;
	}
	
	switch(dataType){
		case 'unsignedInt':
			if(rawValue.length == 4)
				return rawValue.readUint32BE();
			else if(rawValue.length == 2)
				return rawValue.readUInt16BE();
			else
				return rawValue.readUInt8();
			break;
		case 'unsignedFloat':
			return rawValue.readUInt16BE() / 100;
			break;
		case 'signedFloat':
			let intVal = rawValue.readUInt16BE();
			if(intVal > 32768) //JK uses (actualvalue+32768) to make a positive value
				return (intVal - 32768) / 100.0;
			else if (intVal == 0 )
				return 0;
			else
				return intVal / -100.0;
			break;
		case 'ascii':
			return rawValue.toString();
			break;
		case 'tempSensor':
			let result = {};
			result.NTC0 = rawValue.slice(0,2).readUInt16BE(0); //0x80 is BMS Temp. 
			if(rawValue.length > 2)
				result.NTC1 = rawValue.slice(3,5).readUInt16BE(0); //0x81 is Cell Temp 1
			if(rawValue.length > 5)
				result.NTC2 = rawValue.slice(6,8).readUInt16BE(0); //0x82 is Cell Temp 2
			return result;
			break;
		case 'protectionStatus':
			let protectionBytes = rawValue.readUInt16BE();
			let protectionStatus = {};
			//These Node-JBD protections are unavailable in the JK spec: chargeOvertemp, chargeUndertemp, dischargeOvertemp, dischargeUndertemp, shortCircut, frontEndDetectionICError, softwareLockMOS
			let protections = ['lowCapacity', 'bmsOvertemp', 'packOvervolt', 'packUndervolt', 'packOvertemp', 'chargeOvercurrent', 'dischargeOvercurrent', 'cellCurrentDifference', 'packOvertemp2', 'packUndertemp', 'singleCellOvervolt', 'singleCellUndervolt'];

			protections.forEach(function(name, bitpos){
				protectionStatus[name] = isSet(protectionBytes, bitpos);
			});
			return protectionStatus;
			break;
		case 'bmsStatus':
			let statusBytes = rawValue.readUInt16BE();
			let FETStatus = {};
			let statuses = ['charging', 'discharging', 'balancing'];

			statuses.forEach(function(name, bitpos){
				FETStatus[name] = isSet(statusBytes, bitpos);
			});
			return FETStatus;
			break;
			
	}
}


//Represents an expected result from the BMS
const expectedResult = {
	parseCellData: function(cellData) { //parse a cellData buffer
		let numCells = cellData.length / 3;
		this.cellData = {};
		for(let i=0; i<numCells; i++){
			const cellmV = `cell${i}mV`;
            const cellV = `cell${i}V`;
			this.cellData[cellmV] = cellData.slice((i*3)+1, (i*3)+3).readUInt16BE();
			this.cellData[cellV] = this.cellData[cellmV] / 1000.0;
		}
	},
	
	parsePackData: function(rawData) { //Parse an incoming raw data packet 
		let restOfData;
		
		//get cell data length
		if(rawData[11] == 0x79){
			let cellDataLength = rawData[12];
			let cellData = rawData.slice(13, (13 + cellDataLength));
			this.parseCellData(cellData); 
			restOfData = rawData.slice(13 + cellDataLength);
		} else {
			logger.error('Invalid BMS Data received, expected register 0x79, got ' + rawData[11].toString(16));
			return null;
		}
		
		for(let valueName in supportedMeasurements){ //loop through supportedMeasurements and store parsed data depending on data type
			let obj = supportedMeasurements[valueName];
			if(restOfData[obj.offset] != obj.register){
				logger.error('Invalid BMS Data received, expected register 0x' + obj.register.toString(16).padStart(2,'0') + ' at offset 0x' + obj.offset.toString(16).padStart(2,'0') + ', got 0x' + restOfData[obj.offset].toString(16).padStart(2,'0'));
				return null;
			}
			let rawValue = restOfData.slice(obj.offset + 1, obj.offset + 1 + obj.dataLength);
			this[valueName] = convertData(obj.dataType, rawValue);
		}
		
		//packBalCap appears to be missing from the protocol. Can calculate from packRateCap and the current packSOC
		this.packBalCap = Math.floor(this.packRateCap * (this.packSOC/100.0));
		
		return this;
    }
};



//validates the checksum of an incoming result
function validateChecksum(result) {
    //JKBMS uses a simple sum of data as its checksum. The entire packet is summed, starting from the START_BYTES and ending 4 bytes before the end (the last 4 bytes are the checksum)
	//Payload is between the 0th and n-4th byte (last 4 bytes are checksum)
    const sumOfPayload = result.slice(0, result.length-4).reduce((partial_sum, a) => partial_sum + a, 0);
	const givenChecksum = result.slice(result.length-4);
	logger.trace('got sum of payload: ' + sumOfPayload);
	logger.trace('bms provided checksum: ' + givenChecksum.toString('hex'));
    const calculatedChecksum = Buffer.alloc(4); //allocate a 4 byte buffer for the sum
	calculatedChecksum.writeUInt32BE(sumOfPayload,0) //Write the decimal to the sumBuffer in 4 bytes
	logger.trace('we calculated checksum: ' + calculatedChecksum.toString('hex'));
		
    return (givenChecksum.compare(calculatedChecksum) == 0);
}

function bufferToHexString(buffer){
	let ret = "";
	for (let val of buffer.values()){
		if (ret.length > 0) {
			ret += " ";
		}
		ret += val.toString(16).toUpperCase().padStart(2,'0');
	}
	return ret;
}

let formatDateDelt = function(ms){
    let secs = Math.floor(ms/1000);
    let mins = Math.floor(ms/60000);
    let hours = Math.floor(ms/(60000*60));
    if(hours>24){
        let days = Math.floor(hours/24);
        hours = hours - (days*24);
        return days+"d"+hours+"h";
    } else {
        mins = mins - (hours*60)
        return hours+"h"+ (mins+"").padStart(2,0) +"m";
    }
}


//Direct port communication functions

let serialPort;
let parser;


//Emergency function to reset the port should it become unreadable.
async function resetPort(){
	logger.error('Resetting serial port...');
	//let promise = ;
	await serialPort.flush();
	logger.trace('Serial port flushed.');
	await serialPort.close();
}


//Checks if port is open, and if not, opens it. Returns boolean indicating whether port was opened or not.
async function openPort(){
	//Is port already opened?
	if(serialPort !== undefined && serialPort.isOpen)
		return true;
	
	serialPort = new SerialPort({
		path: args.serialport,
		baudRate: args.baudrate,
		autoOpen: false
	});
	
	serialPort.on('error', function(err){
		logger.error('Serial port error: ' + err);
	});

	serialPort.on('open', function(msg){
		logger.info('Serial port opened...');
	});

	serialPort.on('close', function(msg){
		logger.info('Serial port closed...');
	});
		
	let portOpenStatus = await serialPort.open(function(openError){ //Returns boolean indicating whether port was opened or not.
		if(openError){
			logger.error('Serial port open error: ' + openError);
			resetPort(); //Reset the port for the next iteration
			return false;
		}

		parser = serialPort.pipe( //Works in Windows and Linux
			new InterByteTimeoutParser({
				interval: 200
			})
		);
		
		parser.on('error', function(err){
			logger.error('Parser error: ' + err);
		});
		
		parser.on('data', function (rawData) {
			logger.trace('Received Raw Data from BMS (HEX): ' + bufferToHexString(rawData));
			
			if(validateChecksum(rawData)) {
				logger.trace('Data from BMS passed checksum');
					const packData = expectedResult.parsePackData(rawData);
					const cellData = {...packData.cellData};
					delete packData.cellData;
					if(packData == null){
						console.log('Unable to retrieve data from BMS. Try option "-l trace"');
						process.exit();
					}
					if(args.mqttbroker) { 
						logger.trace('Publishing BMS Pack Data to MQTT');
						mqtt.publish(packData, cellData);
					}
					else {
						//TODO: Write a pretty printed human readable table to console in function
						console.log('PACK DATA PRETTY PRINTER:');
						console.log(packData);
						console.log('CELL DATA PRETTY PRINTER:');
						console.log(cellData);
						console.log('No MQTT Broker specified. Exiting...');
						process.exit();
					}     
					iterationCounter++;
					let statusMsgTarget = Math.floor(3600 / args.pollinginterval); //Target once per hour, depending on polling interval
					if(iterationCounter % statusMsgTarget == 0){
						logger.info(`NodeJKBMS Running for ${formatDateDelt(Date.now() - startedAt)} (${iterationCounter} loops, ${numErrors} errors)`)
					};
			}
			else {
				logger.error('Received invalid data from BMS -- Checksum Failed.');
			}
		});
		return true;
	});
	return portOpenStatus; 
}
	
//Called by NodeJS export, opens the port and writes the readAllBuffer to it. Reading data comes from the parser above...
async function requestData(buff, parser){
    logger.trace('Requesting data from BMS...');
    return new Promise(function(resolve, reject) { 
		let portOpenStatus = openPort();
		if(portOpenStatus){
			serialPort.write(buff, function (writeError) {
				if(writeError) {
					logger.error('Serial port write error: ' + writeError);
					numErrors += 1;
					resetPort();
					reject(writeError);
				}
				logger.trace('Request sent (HEX): ' + bufferToHexString(buff));
				resolve();
			})
		} else {
			logger.warn('Could not open serial port. Retrying...');
			reject('Could not open serial port.');
		}
    });      
}

//NodeJS Exports...
module.exports = { 
    getAllData: async function() {
        try {
            logger.trace('Getting data from BMS...');
            await requestData(readAllBuffer, parser); //Loop is implemented in index.js
        }
        catch(e) {
            logger.error(e);
        }
    }
};
