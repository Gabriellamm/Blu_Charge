// 协议处理模块，封装了蓝牙数据包的构建和解析，相当于iOS中的一个工具类
// 协议常量定义
export const PROTOCOL = {
  SERVICE_UUID: 'FE00',
  NOTIFY_CHAR_UUID: 'FE01', //Notify 特征值：0xFE01（设备向小程序发送数据）
  WRITE_CHAR_UUID: 'FE02', // Write 特征值：0xFE02（小程序向设备发送命令）
  
  OTA_CHAR_UUID: 'FE03', // OTA 特征值：0xFE03（用于固件升级数据传输）
  
  // 命令ID 命令列表   小程序 <-> 充电线 相互
  CMD_CHARGE_CONTROL: 0x10,//充电控制暗号  小程序 -> 充电线
  CMD_CHARGE_STATUS: 0x11, // 充电状态反馈 充电线 -> 小程序
   
  CMD_INIT_DEVICE: 0x20, // 初始化暗号  小程序 -> 充电线
  CMD_INIT_RESULT: 0x21, // 初始化结果 充电线 -> 小程序
  
  CMD_CHANGE_NAME: 0x30, // 改藍牙名暗号  小程序 -> 充电线
  CMD_CHANGE_NAME_RESULT: 0x31, // 变更蓝牙名称结果 充电线 -> 小程序
  
  // OTA 命令
  CMD_OTA_START: 0x01,//开始下发升级固件
  CMD_OTA_END: 0x02, //结束下发升级固件
  
  // 分包标志
  PACKET_FIRST: 0x80,
  PACKET_MIDDLE: 0x40,
  PACKET_LAST: 0xC0, // 尾包标志(0x80 | 0x40)表示既是首包也是尾包
  
  // MTU限制
  MAX_PACKET_SIZE: 20 // 每次最多能说20个字
}

// 数据包构建器 相当于一个数据处理的 Helper 类  用于将这个类导出，使得其他文件可以通过 import 引入并使用它，实现代码复用。
// 例如，在其他文件中使用：
// 运行
// import { PacketBuilder } from './PacketBuilder.js';

// // 创建实例并使用
// const packet = new PacketBuilder()
//   .addField('type', 'login')
//   .addField('username', 'test')
//   .build();
export class PacketBuilder { 
  // 构建应用层数据包（Header + Payload + Checksum）
  static buildAppPacket(cmdId, payload) {
    // Header: 2字节（命令类型 + 版本号 + 标志位） //1. 写信封头（2字节）：告诉设备这是什么信
    const header = new ArrayBuffer(2)
    const headerView = new DataView(header)
    headerView.setUint8(0, cmdId)        // 命令类型 第一字节：信的类型（充电/初始化...）
    headerView.setUint8(1, 0x01)         // 版本号1.0 + 标志位 第二字节：协议版本号
    
    // 合并Header和Payload
    const payloadBuffer = this._arrayToBuffer(payload)
	//2. 把信的内容和信封头装在一起
    const fullData = this._concatBuffers(header, payloadBuffer)
    
    // 计算校验和（累加和取反）// 3. 计算校验码（防止信被篡改）
    const checksum = this._calculateChecksum(fullData)
    
    // 最终数据包 4. 最终的信 = 信封头 + 信的内容 + 校验码
    return this._concatBuffers(fullData, new Uint8Array([checksum]).buffer)
  }
  
  // 传输层分包（兼容BLE MTU限制）
static splitPackets(appPacket) {
  const packets = [];
  const dataView = new Uint8Array(appPacket);
  const totalLength = dataView.length;

  // 确保至少有一个包
  if (totalLength === 0) {
    return packets;
  }

  // 为改名命令提供特殊处理，确保使用正确的标志位
  for (let i = 0; i < totalLength; i += PROTOCOL.MAX_PACKET_SIZE - 1) {
    const chunk = dataView.slice(i, i + PROTOCOL.MAX_PACKET_SIZE - 1);
    const packet = new ArrayBuffer(PROTOCOL.MAX_PACKET_SIZE);
    const packetView = new DataView(packet);
    
    let flag;
    const isFirst = i === 0;
    const isLast = i + PROTOCOL.MAX_PACKET_SIZE - 1 >= totalLength;
    
    if (isFirst && isLast) {
      // 单个包：使用正确的单包标志
      // 从日志看命令是30 01 43 4a 43 30 34 32 35 30 34 cf，这是一个完整的改名命令
      // 首字节30是CMD_CHANGE_NAME(0x30)，需要特殊处理确保设备能正确识别
      flag = 0x80; // 对于单包命令，使用首包标志而不是组合标志
    } else if (isFirst) {
      flag = PROTOCOL.PACKET_FIRST; // 0x80
    } else if (isLast) {
      flag = 0x40; // 单独的尾包标志
    } else {
      flag = PROTOCOL.PACKET_MIDDLE; // 0x40
    }
    
    packetView.setUint8(0, flag);
    for (let j = 0; j < chunk.length; j++) {
      packetView.setUint8(j + 1, chunk[j]);
    }
    
    packets.push(packet);
  }
  
  return packets;
}
  
  // 构建控制充电命令
  static buildChargeCommand(operationType, duration) {
    const payload = new ArrayBuffer(3)
    const view = new DataView(payload)
    view.setUint8(0, operationType)  // 操作类型：0关闭，1开启
    view.setUint16(1, duration, false) // 时长（大端序，2字节）
    return this.buildAppPacket(PROTOCOL.CMD_CHARGE_CONTROL, new Uint8Array(payload))
  }
  
  // 构建设备初始化命令
  static buildInitCommand(authCode, disconnectTimeout, chargeCloseTimeout) {
    // 鉴权码：CJC000001 转16进制（9字节）
    const authArray = this._stringToHexArray(authCode)
    
    const payload = new ArrayBuffer(11) // 9+1+1
    const view = new DataView(payload)
    
    // 写入鉴权码（9字节）
    for (let i = 0; i < 9; i++) {
      view.setUint8(i, authArray[i] || 0)
    }
    
    // 蓝牙断连时长（1字节）
    view.setUint8(9, disconnectTimeout)
    // 充电关闭时长（1字节）
    view.setUint8(10, chargeCloseTimeout)
    
    return this.buildAppPacket(PROTOCOL.CMD_INIT_DEVICE, new Uint8Array(payload))
  }
  
  // 构建改名命令
  static buildChangeNameCommand(newName) {
    const nameArray = this._stringToHexArray(newName.padEnd(9, '\0'))
    return this.buildAppPacket(PROTOCOL.CMD_CHANGE_NAME, nameArray)
  }
  
  // 解析设备返回的数据包
  static parseDeviceResponse(buffer) {
    const dataView = new Uint8Array(buffer)
    
    if (dataView.length < 3) {
      throw new Error('数据包长度不足')
    }
    
    // 验证校验和
    const receivedChecksum = dataView[dataView.length - 1]
    const calculatedChecksum = this._calculateChecksum(buffer.slice(0, -1))
    
    if (receivedChecksum !== calculatedChecksum) {
      throw new Error('校验和错误')
    }
    
    const cmdId = dataView[0]
    const payload = dataView.slice(1, -1) // 去掉Header和Checksum
    
    return { cmdId, payload }
  }
  
  // 工具函数
  static _calculateChecksum(buffer) {
    const dataView = new Uint8Array(buffer)
    let sum = 0
    for (let i = 0; i < dataView.length; i++) {
      sum = (sum + dataView[i]) & 0xFF
    }
    return (~sum) & 0xFF // 累加和取反
  }
  
  static _arrayToBuffer(array) {
    const buffer = new ArrayBuffer(array.length)
    const view = new Uint8Array(buffer)
    view.set(array)
    return buffer
  }
  
  static _concatBuffers(buffer1, buffer2) {
    const array1 = new Uint8Array(buffer1)
    const array2 = new Uint8Array(buffer2)
    const result = new Uint8Array(array1.length + array2.length)
    result.set(array1)
    result.set(array2, array1.length)
    return result.buffer
  }
  
  static _stringToHexArray(str) {
    const result = []
    for (let i = 0; i < str.length; i++) {
      result.push(str.charCodeAt(i))
    }
    return result
  }
  
  // ArrayBuffer转16进制字符串（用于调试）
  static ab2hex(buffer) {
    const hexArr = Array.prototype.map.call(
      new Uint8Array(buffer),
      bit => ('00' + bit.toString(16)).slice(-2)
    )
    return hexArr.join(' ')
  }
}