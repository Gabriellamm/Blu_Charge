"use strict";
const PROTOCOL = {
  SERVICE_UUID: "FE00",
  NOTIFY_CHAR_UUID: "FE01",
  //Notify 特征值：0xFE01（设备向小程序发送数据）
  WRITE_CHAR_UUID: "FE02",
  // Write 特征值：0xFE02（小程序向设备发送命令）
  OTA_CHAR_UUID: "FE03",
  // OTA 特征值：0xFE03（用于固件升级数据传输）
  // 命令ID 命令列表   小程序 <-> 充电线 相互
  CMD_CHARGE_CONTROL: 16,
  //充电控制暗号  小程序 -> 充电线
  CMD_CHARGE_STATUS: 17,
  // 充电状态反馈 充电线 -> 小程序
  CMD_INIT_DEVICE: 32,
  // 初始化暗号  小程序 -> 充电线
  CMD_INIT_RESULT: 33,
  // 初始化结果 充电线 -> 小程序
  CMD_CHANGE_NAME: 48,
  // 改藍牙名暗号  小程序 -> 充电线
  CMD_CHANGE_NAME_RESULT: 49,
  // 变更蓝牙名称结果 充电线 -> 小程序
  // OTA 命令
  CMD_OTA_START: 1,
  //开始下发升级固件
  CMD_OTA_END: 2,
  //结束下发升级固件
  // 分包标志
  PACKET_FIRST: 128,
  PACKET_MIDDLE: 64,
  PACKET_LAST: 192,
  // MTU限制
  MAX_PACKET_SIZE: 20
  // 每次最多能说20个字
};
class PacketBuilder {
  // 构建应用层数据包（Header + Payload + Checksum）
  static buildAppPacket(cmdId, payload) {
    const header = new ArrayBuffer(2);
    const headerView = new DataView(header);
    headerView.setUint8(0, cmdId);
    headerView.setUint8(1, 1);
    const payloadBuffer = this._arrayToBuffer(payload);
    const fullData = this._concatBuffers(header, payloadBuffer);
    const checksum = this._calculateChecksum(fullData);
    return this._concatBuffers(fullData, new Uint8Array([checksum]).buffer);
  }
  // 传输层分包（兼容BLE MTU限制）
  // 在 protocol.js 中修改 splitPackets 方法的标志位判断逻辑
  static splitPackets(appPacket) {
    const packets = [];
    const dataView = new Uint8Array(appPacket);
    const totalLength = dataView.length;
    for (let i = 0; i < totalLength; i += PROTOCOL.MAX_PACKET_SIZE - 1) {
      const chunk = dataView.slice(i, i + PROTOCOL.MAX_PACKET_SIZE - 1);
      const packet = new ArrayBuffer(PROTOCOL.MAX_PACKET_SIZE);
      const packetView = new DataView(packet);
      let flag;
      const isFirst = i === 0;
      const isLast = i + PROTOCOL.MAX_PACKET_SIZE - 1 >= totalLength;
      if (isFirst && isLast) {
        flag = PROTOCOL.PACKET_FIRST | PROTOCOL.PACKET_LAST;
      } else if (isFirst) {
        flag = PROTOCOL.PACKET_FIRST;
      } else if (isLast) {
        flag = PROTOCOL.PACKET_LAST;
      } else {
        flag = PROTOCOL.PACKET_MIDDLE;
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
    const payload = new ArrayBuffer(3);
    const view = new DataView(payload);
    view.setUint8(0, operationType);
    view.setUint16(1, duration, false);
    return this.buildAppPacket(PROTOCOL.CMD_CHARGE_CONTROL, new Uint8Array(payload));
  }
  // 构建设备初始化命令
  static buildInitCommand(authCode, disconnectTimeout, chargeCloseTimeout) {
    const authArray = this._stringToHexArray(authCode);
    const payload = new ArrayBuffer(11);
    const view = new DataView(payload);
    for (let i = 0; i < 9; i++) {
      view.setUint8(i, authArray[i] || 0);
    }
    view.setUint8(9, disconnectTimeout);
    view.setUint8(10, chargeCloseTimeout);
    return this.buildAppPacket(PROTOCOL.CMD_INIT_DEVICE, new Uint8Array(payload));
  }
  // 构建改名命令
  static buildChangeNameCommand(newName) {
    const nameArray = this._stringToHexArray(newName.padEnd(9, "\0"));
    return this.buildAppPacket(PROTOCOL.CMD_CHANGE_NAME, nameArray);
  }
  // 解析设备返回的数据包
  static parseDeviceResponse(buffer) {
    const dataView = new Uint8Array(buffer);
    if (dataView.length < 3) {
      throw new Error("数据包长度不足");
    }
    const receivedChecksum = dataView[dataView.length - 1];
    const calculatedChecksum = this._calculateChecksum(buffer.slice(0, -1));
    if (receivedChecksum !== calculatedChecksum) {
      throw new Error("校验和错误");
    }
    const cmdId = dataView[0];
    const payload = dataView.slice(1, -1);
    return { cmdId, payload };
  }
  // 工具函数
  static _calculateChecksum(buffer) {
    const dataView = new Uint8Array(buffer);
    let sum = 0;
    for (let i = 0; i < dataView.length; i++) {
      sum = sum + dataView[i] & 255;
    }
    return ~sum & 255;
  }
  static _arrayToBuffer(array) {
    const buffer = new ArrayBuffer(array.length);
    const view = new Uint8Array(buffer);
    view.set(array);
    return buffer;
  }
  static _concatBuffers(buffer1, buffer2) {
    const array1 = new Uint8Array(buffer1);
    const array2 = new Uint8Array(buffer2);
    const result = new Uint8Array(array1.length + array2.length);
    result.set(array1);
    result.set(array2, array1.length);
    return result.buffer;
  }
  static _stringToHexArray(str) {
    const result = [];
    for (let i = 0; i < str.length; i++) {
      result.push(str.charCodeAt(i));
    }
    return result;
  }
  // ArrayBuffer转16进制字符串（用于调试）
  static ab2hex(buffer) {
    const hexArr = Array.prototype.map.call(
      new Uint8Array(buffer),
      (bit) => ("00" + bit.toString(16)).slice(-2)
    );
    return hexArr.join(" ");
  }
}
exports.PROTOCOL = PROTOCOL;
exports.PacketBuilder = PacketBuilder;
//# sourceMappingURL=../../../.sourcemap/mp-weixin/pages/Blu/protocol.js.map
