"use strict";
const common_vendor = require("../../common/vendor.js");
const OTA_PROTOCOL = {
  // OTA服务UUID（根据文档第6页）
  OTA_SERVICE_UUID: "TELINK_SPP_DATA_OTA",
  // OTA命令操作码（文档第6页表格）
  CMD_OTA_VERSION: 65280,
  // 获取版本
  CMD_OTA_START: 65281,
  // 开始升级
  CMD_OTA_END: 65282,
  // 结束升级
  // OTA数据包格式（文档第7页）
  OTA_PACKET_SIZE: 20,
  // 每包20字节
  DATA_CHUNK_SIZE: 16,
  // 每包数据部分16字节
  ADR_INDEX_SIZE: 2,
  // 地址索引2字节
  CRC16_SIZE: 2
  // CRC校验2字节
};
class OTAUpgradeManager {
  constructor() {
    this.isUpgrading = false;
    this.currentProgress = 0;
    this.totalPackets = 0;
    this.sentPackets = 0;
    this.firmwareData = null;
    this.deviceId = null;
    this.serviceId = null;
    this.characteristicId = null;
  }
  /**
   * 检查设备固件版本（文档3.1.7.1）
   */
  async checkFirmwareVersion(deviceId, serviceId, characteristicId) {
    try {
      const versionCommand = this.buildOTACommand(OTA_PROTOCOL.CMD_OTA_VERSION, new ArrayBuffer(2));
      await this.sendOTACommand(deviceId, serviceId, characteristicId, versionCommand);
      return await this.waitForVersionResponse();
    } catch (error) {
      common_vendor.index.__f__("error", "at pages/Blu/ota-upgrade.js:46", "检查固件版本失败:", error);
      throw error;
    }
  }
  /**
   * 开始OTA升级流程（文档3.1.7.2）
   */
  async startOTAUpgrade(deviceInfo, firmwareUrl) {
    if (this.isUpgrading) {
      throw new Error("正在升级中，请等待完成");
    }
    try {
      this.isUpgrading = true;
      this.currentProgress = 0;
      this.firmwareData = await this.downloadFirmware(firmwareUrl);
      await this.connectOTAService(deviceInfo);
      await this.sendStartCommand();
      await this.transmitFirmwareData();
      await this.sendEndCommand();
      await this.verifyUpgrade();
      return true;
    } catch (error) {
      common_vendor.index.__f__("error", "at pages/Blu/ota-upgrade.js:84", "OTA升级失败:", error);
      this.isUpgrading = false;
      throw error;
    } finally {
      this.isUpgrading = false;
    }
  }
  /**
   * 下载固件文件（文档第7页：从服务器中读取升级固件文件）
   */
  async downloadFirmware(firmwareUrl) {
    return new Promise((resolve, reject) => {
      common_vendor.index.downloadFile({
        url: firmwareUrl,
        success: (res) => {
          if (res.statusCode === 200) {
            common_vendor.index.getFileSystemManager().readFile({
              filePath: res.tempFilePath,
              success: (fileRes) => {
                const firmware = new Uint8Array(fileRes.data);
                common_vendor.index.__f__("log", "at pages/Blu/ota-upgrade.js:107", `固件下载成功，大小: ${firmware.length} 字节`);
                resolve(firmware);
              },
              fail: reject
            });
          } else {
            reject(new Error(`下载失败，状态码: ${res.statusCode}`));
          }
        },
        fail: reject
      });
    });
  }
  /**
   * 连接OTA服务（切换到OTA专用的蓝牙服务）
   */
  async connectOTAService(deviceInfo) {
    this.deviceId = deviceInfo.deviceId;
    const services = await this.discoverServices(deviceInfo.deviceId);
    const otaService = services.find(
      (s) => s.uuid.toLowerCase().includes(OTA_PROTOCOL.OTA_SERVICE_UUID.toLowerCase())
    );
    if (!otaService) {
      throw new Error("未找到OTA服务");
    }
    this.serviceId = otaService.uuid;
    const characteristics = await this.discoverCharacteristics(deviceInfo.deviceId, otaService.uuid);
    const writeCharacteristic = characteristics.find((c) => c.properties.write);
    if (!writeCharacteristic) {
      throw new Error("未找到OTA写入特征值");
    }
    this.characteristicId = writeCharacteristic.uuid;
  }
  /**
   * 发送开始升级命令（文档第7页：CMD_OTA_START）
   */
  async sendStartCommand() {
    const startCommand = this.buildOTACommand(OTA_PROTOCOL.CMD_OTA_START, new ArrayBuffer(2));
    await this.sendOTACommand(this.deviceId, this.serviceId, this.characteristicId, startCommand);
    common_vendor.index.__f__("log", "at pages/Blu/ota-upgrade.js:158", "OTA开始命令发送成功");
  }
  /**
   * 传输固件数据（核心功能 - 文档第7页分片传输）
   */
  async transmitFirmwareData() {
    const firmware = this.firmwareData;
    this.totalPackets = Math.ceil(firmware.length / OTA_PROTOCOL.DATA_CHUNK_SIZE);
    this.sentPackets = 0;
    common_vendor.index.__f__("log", "at pages/Blu/ota-upgrade.js:169", `开始传输固件，总包数: ${this.totalPackets}`);
    const BATCH_SIZE = 50;
    for (let batchStart = 0; batchStart < this.totalPackets; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, this.totalPackets);
      const promises = [];
      for (let i = batchStart; i < batchEnd; i++) {
        promises.push(this.sendFirmwarePacket(i));
      }
      await Promise.all(promises);
      this.updateProgress(batchEnd);
      await this.delay(100);
    }
  }
  /**
   * 发送单个固件数据包（文档第7页构造OTA数据包）
   */
  async sendFirmwarePacket(packetIndex) {
    const firmware = this.firmwareData;
    const start = packetIndex * OTA_PROTOCOL.DATA_CHUNK_SIZE;
    const end = Math.min(start + OTA_PROTOCOL.DATA_CHUNK_SIZE, firmware.length);
    let chunk = firmware.slice(start, end);
    if (chunk.length < OTA_PROTOCOL.DATA_CHUNK_SIZE) {
      const paddedChunk = new Uint8Array(OTA_PROTOCOL.DATA_CHUNK_SIZE);
      paddedChunk.set(chunk);
      paddedChunk.fill(255, chunk.length);
      chunk = paddedChunk;
    }
    const otaPacket = this.buildOTAPacket(packetIndex, chunk);
    await this.sendOTACommand(this.deviceId, this.serviceId, this.characteristicId, otaPacket);
    this.sentPackets++;
  }
  /**
   * 构建OTA数据包（文档第7页示例代码）
   */
  buildOTAPacket(adrIndex, firmwareChunk) {
    const buffer = new ArrayBuffer(OTA_PROTOCOL.OTA_PACKET_SIZE);
    const view = new DataView(buffer);
    view.setUint16(0, adrIndex, true);
    for (let i = 0; i < OTA_PROTOCOL.DATA_CHUNK_SIZE; i++) {
      view.setUint8(2 + i, firmwareChunk[i]);
    }
    const crc = this.calculateCRC16(buffer.slice(0, 18));
    view.setUint16(18, crc, true);
    return buffer;
  }
  /**
   * CRC16计算（文档第8页代码）
   */
  calculateCRC16(data) {
    let crc = 0;
    const buffer = new Uint8Array(data);
    for (let i = 0; i < buffer.length; i++) {
      crc ^= buffer[i] << 8;
      for (let j = 0; j < 8; j++) {
        if (crc & 32768) {
          crc = crc << 1 ^ 4129;
        } else {
          crc = crc << 1;
        }
        crc &= 65535;
      }
    }
    return crc;
  }
  /**
   * 发送结束命令（文档第7页：CMD_OTA_END）
   */
  async sendEndCommand() {
    const maxAdrIndex = this.totalPackets - 1;
    const xorValue = maxAdrIndex ^ 65535;
    const endBuffer = new ArrayBuffer(6);
    const view = new DataView(endBuffer);
    view.setUint16(0, OTA_PROTOCOL.CMD_OTA_END, true);
    view.setUint16(2, maxAdrIndex, true);
    view.setUint16(4, xorValue, true);
    await this.sendOTACommand(this.deviceId, this.serviceId, this.characteristicId, endBuffer);
    common_vendor.index.__f__("log", "at pages/Blu/ota-upgrade.js:284", "OTA结束命令发送成功");
  }
  /**
   * 验证升级结果（文档第7页：验证版本号是否匹配）
   */
  async verifyUpgrade() {
    common_vendor.index.__f__("log", "at pages/Blu/ota-upgrade.js:291", "等待设备重启...");
    await this.delay(5e3);
    await this.reconnectDevice();
    const newVersion = await this.checkFirmwareVersion(
      this.deviceId,
      this.serviceId,
      this.characteristicId
    );
    const expectedVersion = await this.getExpectedVersion();
    if (newVersion === expectedVersion) {
      common_vendor.index.__f__("log", "at pages/Blu/ota-upgrade.js:311", "OTA升级成功！");
      return true;
    } else {
      throw new Error(`版本不匹配: 当前${newVersion}, 预期${expectedVersion}`);
    }
  }
  /**
   * 构建OTA命令（通用命令构建）
   */
  buildOTACommand(opcode, data) {
    const buffer = new ArrayBuffer(2 + (data ? data.byteLength : 0));
    const view = new DataView(buffer);
    view.setUint16(0, opcode, true);
    if (data) {
      const dataView = new Uint8Array(data);
      for (let i = 0; i < dataView.length; i++) {
        view.setUint8(2 + i, dataView[i]);
      }
    }
    return buffer;
  }
  /**
   * 发送OTA命令（使用Write Without Response）
   */
  async sendOTACommand(deviceId, serviceId, characteristicId, data) {
    return new Promise((resolve, reject) => {
      common_vendor.index.writeBLECharacteristicValue({
        deviceId,
        serviceId,
        characteristicId,
        value: data,
        writeType: "writeWithoutResponse",
        // 关键参数，不等待响应
        success: resolve,
        fail: (err) => {
          common_vendor.index.__f__("error", "at pages/Blu/ota-upgrade.js:350", "OTA命令发送失败:", err);
          reject(err);
        }
      });
    });
  }
  /**
   * 更新进度条（文档第7页进度计算公式）
   */
  updateProgress(currentPacketIndex) {
    const progress = Math.round(currentPacketIndex * OTA_PROTOCOL.DATA_CHUNK_SIZE / this.firmwareData.length * 100);
    this.currentProgress = Math.min(progress, 100);
    if (this.onProgressUpdate) {
      this.onProgressUpdate(this.currentProgress);
    }
    common_vendor.index.__f__("log", "at pages/Blu/ota-upgrade.js:370", `OTA升级进度: ${this.currentProgress}%`);
  }
  // 工具函数
  discoverServices(deviceId) {
    return new Promise((resolve, reject) => {
      common_vendor.index.getBLEDeviceServices({
        deviceId,
        success: (res) => resolve(res.services),
        fail: reject
      });
    });
  }
  discoverCharacteristics(deviceId, serviceId) {
    return new Promise((resolve, reject) => {
      common_vendor.index.getBLEDeviceCharacteristics({
        deviceId,
        serviceId,
        success: (res) => resolve(res.characteristics),
        fail: reject
      });
    });
  }
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  // 这些方法需要根据实际项目实现
  async waitForVersionResponse() {
    return "CC1_V1.1";
  }
  async reconnectDevice() {
    common_vendor.index.__f__("log", "at pages/Blu/ota-upgrade.js:408", "重新连接设备...");
  }
  async getExpectedVersion() {
    return "CC1_V1.1";
  }
  // 设置进度回调
  setProgressCallback(callback) {
    this.onProgressUpdate = callback;
  }
  // 获取当前状态
  getUpgradeStatus() {
    return {
      isUpgrading: this.isUpgrading,
      progress: this.currentProgress,
      totalPackets: this.totalPackets,
      sentPackets: this.sentPackets
    };
  }
}
const otaManager = new OTAUpgradeManager();
exports.otaManager = otaManager;
//# sourceMappingURL=../../../.sourcemap/mp-weixin/pages/Blu/ota-upgrade.js.map
