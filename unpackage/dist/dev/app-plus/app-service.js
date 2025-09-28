if (typeof Promise !== "undefined" && !Promise.prototype.finally) {
  Promise.prototype.finally = function(callback) {
    const promise = this.constructor;
    return this.then(
      (value) => promise.resolve(callback()).then(() => value),
      (reason) => promise.resolve(callback()).then(() => {
        throw reason;
      })
    );
  };
}
;
if (typeof uni !== "undefined" && uni && uni.requireGlobal) {
  const global = uni.requireGlobal();
  ArrayBuffer = global.ArrayBuffer;
  Int8Array = global.Int8Array;
  Uint8Array = global.Uint8Array;
  Uint8ClampedArray = global.Uint8ClampedArray;
  Int16Array = global.Int16Array;
  Uint16Array = global.Uint16Array;
  Int32Array = global.Int32Array;
  Uint32Array = global.Uint32Array;
  Float32Array = global.Float32Array;
  Float64Array = global.Float64Array;
  BigInt64Array = global.BigInt64Array;
  BigUint64Array = global.BigUint64Array;
}
;
if (uni.restoreGlobal) {
  uni.restoreGlobal(Vue, weex, plus, setTimeout, clearTimeout, setInterval, clearInterval);
}
(function(vue) {
  "use strict";
  function formatAppLog(type, filename, ...args) {
    if (uni.__log__) {
      uni.__log__(type, filename, ...args);
    } else {
      console[type].apply(console, [...args, filename]);
    }
  }
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
    // 尾包标志(0x80 | 0x40)表示既是首包也是尾包
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
    static splitPackets(appPacket) {
      const packets = [];
      const dataView = new Uint8Array(appPacket);
      const totalLength = dataView.length;
      if (totalLength === 0) {
        return packets;
      }
      for (let i = 0; i < totalLength; i += PROTOCOL.MAX_PACKET_SIZE - 1) {
        const chunk = dataView.slice(i, i + PROTOCOL.MAX_PACKET_SIZE - 1);
        const packet = new ArrayBuffer(PROTOCOL.MAX_PACKET_SIZE);
        const packetView = new DataView(packet);
        let flag;
        const isFirst = i === 0;
        const isLast = i + PROTOCOL.MAX_PACKET_SIZE - 1 >= totalLength;
        if (isFirst && isLast) {
          flag = 128;
        } else if (isFirst) {
          flag = PROTOCOL.PACKET_FIRST;
        } else if (isLast) {
          flag = 64;
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
        formatAppLog("error", "at pages/Blu/ota-upgrade.js:46", "检查固件版本失败:", error);
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
        formatAppLog("error", "at pages/Blu/ota-upgrade.js:84", "OTA升级失败:", error);
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
        uni.downloadFile({
          url: firmwareUrl,
          success: (res) => {
            if (res.statusCode === 200) {
              uni.getFileSystemManager().readFile({
                filePath: res.tempFilePath,
                success: (fileRes) => {
                  const firmware = new Uint8Array(fileRes.data);
                  formatAppLog("log", "at pages/Blu/ota-upgrade.js:107", `固件下载成功，大小: ${firmware.length} 字节`);
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
      formatAppLog("log", "at pages/Blu/ota-upgrade.js:158", "OTA开始命令发送成功");
    }
    /**
     * 传输固件数据（核心功能 - 文档第7页分片传输）
     */
    async transmitFirmwareData() {
      const firmware = this.firmwareData;
      this.totalPackets = Math.ceil(firmware.length / OTA_PROTOCOL.DATA_CHUNK_SIZE);
      this.sentPackets = 0;
      formatAppLog("log", "at pages/Blu/ota-upgrade.js:169", `开始传输固件，总包数: ${this.totalPackets}`);
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
      formatAppLog("log", "at pages/Blu/ota-upgrade.js:284", "OTA结束命令发送成功");
    }
    /**
     * 验证升级结果（文档第7页：验证版本号是否匹配）
     */
    async verifyUpgrade() {
      formatAppLog("log", "at pages/Blu/ota-upgrade.js:291", "等待设备重启...");
      await this.delay(5e3);
      await this.reconnectDevice();
      const newVersion = await this.checkFirmwareVersion(
        this.deviceId,
        this.serviceId,
        this.characteristicId
      );
      const expectedVersion = await this.getExpectedVersion();
      if (newVersion === expectedVersion) {
        formatAppLog("log", "at pages/Blu/ota-upgrade.js:311", "OTA升级成功！");
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
        uni.writeBLECharacteristicValue({
          deviceId,
          serviceId,
          characteristicId,
          value: data,
          writeType: "writeWithoutResponse",
          // 关键参数，不等待响应
          success: resolve,
          fail: (err) => {
            formatAppLog("error", "at pages/Blu/ota-upgrade.js:350", "OTA命令发送失败:", err);
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
      formatAppLog("log", "at pages/Blu/ota-upgrade.js:370", `OTA升级进度: ${this.currentProgress}%`);
    }
    // 工具函数
    discoverServices(deviceId) {
      return new Promise((resolve, reject) => {
        uni.getBLEDeviceServices({
          deviceId,
          success: (res) => resolve(res.services),
          fail: reject
        });
      });
    }
    discoverCharacteristics(deviceId, serviceId) {
      return new Promise((resolve, reject) => {
        uni.getBLEDeviceCharacteristics({
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
      formatAppLog("log", "at pages/Blu/ota-upgrade.js:408", "重新连接设备...");
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
  const _export_sfc = (sfc, props) => {
    const target = sfc.__vccOpts || sfc;
    for (const [key, val] of props) {
      target[key] = val;
    }
    return target;
  };
  const _sfc_main$2 = {
    data() {
      return {
        // 原有的蓝牙状态
        bluetoothAvailable: false,
        bluetoothState: "未初始化",
        scanning: false,
        connected: false,
        connectedDevice: null,
        // 原有的设备状态
        devices: [],
        chargeStatus: "未充电",
        remainingTime: 0,
        charging: false,
        // 原有的蓝牙特征值
        serviceId: "",
        notifyCharId: "",
        writeCharId: "",
        // 原有的调试
        logs: [],
        // ✅ 新增：OTA相关数据
        deviceVersion: "",
        // 设备当前版本
        latestVersion: "",
        // 服务器最新版本
        hasUpdate: false,
        // 是否有更新
        otaStatus: {
          // OTA升级状态
          isUpgrading: false,
          progress: 0,
          totalPackets: 0,
          sentPackets: 0
        },
        upgradeResult: ""
        // 升级结果：success/failed
      };
    },
    onLoad() {
      this.addLog("页面加载完成");
      this.initBluetooth();
      this.monitorOTAStatus();
    },
    methods: {
      // 初始化蓝牙
      async initBluetooth() {
        this.addLog("初始化蓝牙适配器...");
        try {
          const res = await new Promise((resolve, reject) => {
            uni.openBluetoothAdapter({
              success: resolve,
              fail: reject
            });
          });
          this.addLog("蓝牙适配器打开成功");
          this.bluetoothAvailable = true;
          this.bluetoothState = "就绪";
          uni.onBluetoothAdapterStateChange((res2) => {
            this.addLog(`蓝牙状态变化: 可用=${res2.available}, 搜索中=${res2.discovering}`);
            this.bluetoothAvailable = res2.available;
          });
          uni.onBluetoothDeviceFound(this.onDeviceFound.bind(this));
        } catch (err) {
          this.addLog(`蓝牙初始化失败: ${JSON.stringify(err)}`);
          uni.showModal({
            title: "提示",
            content: "请检查手机蓝牙是否开启，并授予蓝牙权限",
            showCancel: false
          });
        }
      },
      // 扫描设备
      async scanDevices() {
        if (!this.bluetoothAvailable) {
          uni.showToast({ title: "蓝牙未就绪", icon: "none" });
          return;
        }
        this.addLog("开始扫描CJC设备...");
        this.scanning = true;
        this.devices = [];
        try {
          await new Promise((resolve, reject) => {
            uni.startBluetoothDevicesDiscovery({
              // services: [PROTOCOL.SERVICE_UUID],
              allowDuplicatesKey: false,
              success: resolve,
              fail: reject
            });
          });
          this.addLog("扫描启动成功");
          setTimeout(() => {
            this.stopScan();
          }, 5e3);
        } catch (err) {
          this.addLog(`扫描启动失败: ${JSON.stringify(err)}`);
          this.scanning = false;
        }
      },
      // 停止扫描
      async stopScan() {
        try {
          await new Promise((resolve, reject) => {
            uni.stopBluetoothDevicesDiscovery({
              success: resolve,
              fail: reject
            });
          });
          this.addLog("扫描已停止");
        } catch (err) {
          this.addLog(`停止扫描失败: ${JSON.stringify(err)}`);
        }
        this.scanning = false;
      },
      // 设备发现回调
      onDeviceFound(res) {
        const cjcDevices = res.devices.filter(
          (device) => device.name && device.name.startsWith("CJC")
        );
        cjcDevices.forEach((device) => {
          if (!this.devices.find((d) => d.deviceId === device.deviceId)) {
            this.devices.push(device);
            this.addLog(`发现设备: ${device.name} (${device.RSSI}dBm)`);
          }
        });
      },
      // 连接设备
      async connectDevice(device) {
        this.addLog(`连接设备: ${device.name}`);
        try {
          await new Promise((resolve, reject) => {
            uni.createBLEConnection({
              deviceId: device.deviceId,
              success: resolve,
              fail: reject
            });
          });
          this.addLog("物理连接成功");
          this.connected = true;
          this.connectedDevice = device;
          await this.getServices(device.deviceId);
        } catch (err) {
          this.addLog(`连接失败: ${JSON.stringify(err)}`);
          uni.showToast({ title: "连接失败", icon: "none" });
        }
      },
      // 获取服务
      async getServices(deviceId) {
        try {
          const res = await new Promise((resolve, reject) => {
            uni.getBLEDeviceServices({
              deviceId,
              success: resolve,
              fail: reject
            });
          });
          const targetService = res.services.find((s) => s.uuid.toUpperCase().includes(PROTOCOL.SERVICE_UUID));
          if (!targetService) {
            throw new Error("未找到目标服务");
          }
          this.serviceId = targetService.uuid;
          this.addLog(`找到服务: ${targetService.uuid}`);
          await this.getCharacteristics(deviceId);
        } catch (err) {
          this.addLog(`获取服务失败: ${err.message}`);
        }
      },
      // 获取特征值
      async getCharacteristics(deviceId) {
        try {
          const res = await new Promise((resolve, reject) => {
            uni.getBLEDeviceCharacteristics({
              deviceId,
              serviceId: this.serviceId,
              success: resolve,
              fail: reject
            });
          });
          for (let char of res.characteristics) {
            const uuid = char.uuid.toUpperCase();
            if (uuid.includes(PROTOCOL.NOTIFY_CHAR_UUID) && char.properties.notify) {
              this.notifyCharId = char.uuid;
              this.addLog(`找到Notify特征: ${char.uuid}`);
            }
            if (uuid.includes(PROTOCOL.WRITE_CHAR_UUID) && char.properties.write) {
              this.writeCharId = char.uuid;
              this.addLog(`找到Write特征: ${char.uuid}`);
            }
          }
          if (!this.notifyCharId || !this.writeCharId) {
            throw new Error("未找到必要的特征值");
          }
          await this.enableNotify(deviceId);
        } catch (err) {
          this.addLog(`获取特征值失败: ${err.message}`);
        }
      },
      // 启用通知
      async enableNotify(deviceId) {
        try {
          await new Promise((resolve, reject) => {
            uni.notifyBLECharacteristicValueChange({
              deviceId,
              serviceId: this.serviceId,
              characteristicId: this.notifyCharId,
              state: true,
              success: resolve,
              fail: reject
            });
          });
          this.addLog("通知启用成功");
          uni.onBLECharacteristicValueChange(this.onDeviceDataReceived.bind(this));
          setTimeout(() => {
            this.initDevice();
          }, 500);
        } catch (err) {
          this.addLog(`启用通知失败: ${JSON.stringify(err)}`);
        }
      },
      // 接收设备数据
      onDeviceDataReceived(res) {
        try {
          const hexData = PacketBuilder.ab2hex(res.value);
          this.addLog(`收到设备数据: ${hexData}`);
          const parsedData = PacketBuilder.parseDeviceResponse(res.value);
          this.handleDeviceCommand(parsedData.cmdId, parsedData.payload);
        } catch (err) {
          this.addLog(`数据解析错误: ${err.message}`);
        }
      },
      // 处理设备命令
      handleDeviceCommand(cmdId, payload) {
        const dataView = new DataView(payload.buffer);
        switch (cmdId) {
          case PROTOCOL.CMD_CHARGE_STATUS:
            const status = dataView.getUint8(0);
            const remainingTime = dataView.getUint16(1, false);
            this.chargeStatus = status === 1 ? "充电中" : "未充电";
            this.remainingTime = remainingTime;
            this.charging = status === 1;
            this.addLog(`充电状态: ${this.chargeStatus}, 剩余: ${remainingTime}分钟`);
            break;
          case PROTOCOL.CMD_INIT_RESULT:
            const initStatus = dataView.getUint8(0);
            this.addLog(`设备初始化: ${initStatus === 1 ? "成功" : "失败"}`);
            if (initStatus === 1) {
              uni.showToast({ title: "初始化成功" });
            } else {
              uni.showToast({ title: "初始化失败", icon: "none" });
            }
            break;
          case PROTOCOL.CMD_CHANGE_NAME_RESULT:
            const nameStatus = dataView.getUint8(0);
            const resultMessage = nameStatus === 1 ? "成功" : "失败";
            this.addLog(`改名结果: ${resultMessage}`);
            uni.showToast({
              title: `修改名称${resultMessage}`,
              icon: nameStatus === 1 ? "success" : "none"
            });
            break;
          default:
            this.addLog(`未知命令: 0x${cmdId.toString(16)}`);
        }
      },
      // 开始充电
      async startCharge(duration) {
        if (!this.connected) {
          uni.showToast({ title: "设备未连接", icon: "none" });
          return;
        }
        try {
          const command = PacketBuilder.buildChargeCommand(1, duration);
          await this.sendCommand(command);
          this.addLog(`开始充电: ${duration}分钟`);
        } catch (err) {
          this.addLog(`发送充电命令失败: ${err.message}`);
        }
      },
      // 停止充电
      async stopCharge() {
        if (!this.connected) {
          return;
        }
        try {
          const command = PacketBuilder.buildChargeCommand(0, 0);
          await this.sendCommand(command);
          this.addLog("停止充电");
        } catch (err) {
          this.addLog(`发送停止命令失败: ${err.message}`);
        }
      },
      // 初始化设备
      async initDevice() {
        if (!this.connected) {
          return;
        }
        try {
          const authCode = this.connectedDevice.name || "CJC000001";
          const command = PacketBuilder.buildInitCommand(authCode, 10, 5);
          await this.sendCommand(command);
          this.addLog(`发送初始化命令: ${authCode}`);
        } catch (err) {
          this.addLog(`发送初始化命令失败: ${err.message}`);
        }
      },
      // 修改设备名称
      async changeDeviceName() {
        if (!this.connected) {
          return;
        }
        uni.showModal({
          title: "修改设备名称",
          content: "9字符以内",
          editable: true,
          placeholderText: "CJC000002",
          success: async (res) => {
            if (res.confirm && res.content) {
              const newName = res.content.padEnd(9, "\0").slice(0, 9);
              try {
                const command = PacketBuilder.buildChangeNameCommand(newName);
                await this.sendCommand(command);
                this.addLog(`发送改名命令: ${newName}`);
              } catch (err) {
                this.addLog(`发送改名命令失败: ${err.message}`);
              }
            }
          }
        });
      },
      // 发送命令到设备
      async sendCommand(commandData) {
        if (!this.connected || !this.writeCharId) {
          throw new Error("设备未连接或未找到写入特征");
        }
        const packets = PacketBuilder.splitPackets(commandData);
        this.addLog(`分包发送: ${packets.length}包`);
        try {
          for (let i = 0; i < packets.length; i++) {
            await new Promise((resolve, reject) => {
              uni.writeBLECharacteristicValue({
                deviceId: this.connectedDevice.deviceId,
                serviceId: this.serviceId,
                characteristicId: this.writeCharId,
                value: packets[i],
                success: resolve,
                fail: reject
              });
            });
            if (i < packets.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          }
          this.addLog(`命令发送完成: ${PacketBuilder.ab2hex(commandData)}`);
        } catch (err) {
          this.addLog(`发送命令失败: ${err.message}`);
          throw err;
        }
      },
      // 断开连接
      async disconnectDevice() {
        if (this.connectedDevice) {
          try {
            await new Promise((resolve, reject) => {
              uni.closeBLEConnection({
                deviceId: this.connectedDevice.deviceId,
                success: resolve,
                fail: reject
              });
            });
            this.addLog("设备已断开");
            this.connected = false;
            this.connectedDevice = null;
            this.charging = false;
            this.chargeStatus = "未充电";
            this.remainingTime = 0;
          } catch (err) {
            this.addLog(`断开连接失败: ${JSON.stringify(err)}`);
          }
        }
      },
      // 复制设备名称到剪贴板
      copyDeviceName() {
        if (this.connectedDevice && this.connectedDevice.name) {
          uni.setClipboardData({
            data: this.connectedDevice.name,
            success: () => {
              uni.showToast({
                title: "设备名称已复制",
                icon: "success"
              });
              this.addLog(`已复制设备名称: ${this.connectedDevice.name}`);
            }
          });
        }
      },
      // 工具函数
      addLog(message) {
        const timestamp = (/* @__PURE__ */ new Date()).toLocaleTimeString();
        const logMessage = `[${timestamp}] ${message}`;
        this.logs.unshift(logMessage);
        formatAppLog("log", "at pages/Blu/Blu.vue:631", logMessage);
        if (this.logs.length > 50) {
          this.logs.pop();
        }
      },
      clearLogs() {
        this.logs = [];
      }
    },
    // ✅ 新增：OTA相关方法
    /**
     * 检查设备版本
     */
    async checkVersion() {
      if (!this.connected) {
        uni.showToast({ title: "设备未连接", icon: "none" });
        return;
      }
      try {
        uni.showLoading({ title: "检查版本中..." });
        this.deviceVersion = await otaManager.checkFirmwareVersion(
          this.connectedDevice.deviceId,
          this.serviceId,
          this.writeCharId
        );
        await this.fetchLatestVersion();
        this.hasUpdate = this.deviceVersion !== this.latestVersion;
        uni.hideLoading();
        uni.showToast({
          title: this.hasUpdate ? "发现新版本" : "已是最新版本",
          icon: "none"
        });
      } catch (error) {
        uni.hideLoading();
        uni.showToast({ title: "版本检查失败", icon: "none" });
        formatAppLog("error", "at pages/Blu/Blu.vue:677", "版本检查失败:", error);
      }
    },
    /**
     * 开始OTA升级
     */
    async startOTAUpgrade() {
      if (!this.hasUpdate) {
        uni.showToast({ title: "没有可用更新", icon: "none" });
        return;
      }
      if (!this.connected || !this.connectedDevice) {
        uni.showToast({ title: "设备未连接", icon: "none" });
        return;
      }
      try {
        const { confirm } = await uni.showModal({
          title: "固件升级",
          content: "升级过程中请勿断开设备连接，确保设备电量充足。是否继续？",
          confirmText: "开始升级",
          cancelText: "取消"
        });
        if (!confirm)
          return;
        uni.showLoading({ title: "准备升级..." });
        otaManager.setProgressCallback((progress) => {
          this.otaStatus.progress = progress;
          this.addLog(`OTA升级进度: ${progress}%`);
        });
        const deviceInfo = {
          deviceId: this.connectedDevice.deviceId,
          name: this.connectedDevice.name,
          serviceId: this.serviceId,
          characteristicId: this.writeCharId
        };
        await otaManager.startOTAUpgrade(
          deviceInfo,
          "https://your-server.com/firmware.bin"
          // 固件下载地址
        );
        this.upgradeResult = "success";
        uni.hideLoading();
        uni.showToast({ title: "升级成功！", icon: "success" });
        this.addLog("OTA升级成功");
        setTimeout(() => {
          this.checkVersion();
        }, 2e3);
      } catch (error) {
        uni.hideLoading();
        this.upgradeResult = "failed";
        uni.showToast({ title: "升级失败: " + error.message, icon: "none" });
        this.addLog("OTA升级失败: " + error.message);
        formatAppLog("error", "at pages/Blu/Blu.vue:743", "OTA升级失败:", error);
      }
    },
    /**
     * 取消OTA升级
     */
    cancelOTAUpgrade() {
      uni.showModal({
        title: "取消升级",
        content: "确定要取消固件升级吗？这可能导致设备异常。",
        success: ({ confirm }) => {
          if (confirm) {
            this.otaStatus.isUpgrading = false;
            this.upgradeResult = "cancelled";
            uni.showToast({ title: "升级已取消", icon: "none" });
            this.addLog("OTA升级已取消");
          }
        }
      });
    },
    /**
     * 从服务器获取最新版本信息
     */
    async fetchLatestVersion() {
      return new Promise((resolve) => {
        setTimeout(() => {
          this.latestVersion = "CC1_V1.1";
          resolve();
        }, 1e3);
      });
    },
    /**
     * 监听OTA状态变化
     */
    monitorOTAStatus() {
      setInterval(() => {
        const status = otaManager.getUpgradeStatus();
        this.otaStatus = { ...this.otaStatus, ...status };
      }, 500);
    },
    // ✅ 保留原有的工具方法
    addLog(message) {
      const now = /* @__PURE__ */ new Date();
      const hours = now.getHours().toString().padStart(2, "0");
      const minutes = now.getMinutes().toString().padStart(2, "0");
      const seconds = now.getSeconds().toString().padStart(2, "0");
      const timestamp = `${hours}:${minutes}:${seconds}`;
      const logMessage = `[${timestamp}] ${message}`;
      this.logs.unshift(logMessage);
      if (this.logs.length > 50)
        this.logs.pop();
      formatAppLog("log", "at pages/Blu/Blu.vue:803", logMessage);
    },
    clearLogs() {
      this.logs = [];
    }
  };
  function _sfc_render$1(_ctx, _cache, $props, $setup, $data, $options) {
    return vue.openBlock(), vue.createElementBlock("view", { class: "container" }, [
      vue.createCommentVNode(" 原有的设备状态显示 "),
      vue.createElementVNode("view", { class: "card" }, [
        vue.createElementVNode("text", { class: "title" }, "设备状态"),
        vue.createElementVNode("view", { class: "status-line" }, [
          vue.createElementVNode(
            "text",
            null,
            "蓝牙: " + vue.toDisplayString($data.bluetoothState),
            1
            /* TEXT */
          ),
          vue.createElementVNode(
            "text",
            null,
            "连接: " + vue.toDisplayString($data.connected ? "已连接" : "未连接"),
            1
            /* TEXT */
          )
        ]),
        $data.connectedDevice ? (vue.openBlock(), vue.createElementBlock("view", {
          key: 0,
          class: "status-line"
        }, [
          vue.createElementVNode(
            "text",
            {
              onLongpress: _cache[0] || (_cache[0] = (...args) => $options.copyDeviceName && $options.copyDeviceName(...args)),
              class: "copyable"
            },
            "设备: " + vue.toDisplayString($data.connectedDevice.name),
            33
            /* TEXT, NEED_HYDRATION */
          ),
          vue.createElementVNode(
            "text",
            null,
            "信号: " + vue.toDisplayString($data.connectedDevice.RSSI) + "dBm",
            1
            /* TEXT */
          )
        ])) : vue.createCommentVNode("v-if", true),
        vue.createElementVNode("view", { class: "status-line" }, [
          vue.createElementVNode(
            "text",
            null,
            "充电: " + vue.toDisplayString($data.chargeStatus),
            1
            /* TEXT */
          ),
          vue.createElementVNode(
            "text",
            null,
            "剩余: " + vue.toDisplayString($data.remainingTime) + "分钟",
            1
            /* TEXT */
          )
        ])
      ]),
      vue.createCommentVNode(" 原有的设备列表 "),
      $data.devices.length > 0 ? (vue.openBlock(), vue.createElementBlock("view", {
        key: 0,
        class: "card"
      }, [
        vue.createElementVNode(
          "text",
          { class: "title" },
          "发现设备 (" + vue.toDisplayString($data.devices.length) + ")",
          1
          /* TEXT */
        ),
        (vue.openBlock(true), vue.createElementBlock(
          vue.Fragment,
          null,
          vue.renderList($data.devices, (device) => {
            return vue.openBlock(), vue.createElementBlock("view", {
              key: device.deviceId,
              class: "device-item",
              onClick: ($event) => $options.connectDevice(device)
            }, [
              vue.createElementVNode(
                "text",
                { class: "device-name" },
                vue.toDisplayString(device.name || "未知设备"),
                1
                /* TEXT */
              ),
              vue.createElementVNode(
                "text",
                { class: "device-info" },
                "ID: " + vue.toDisplayString(device.deviceId.slice(-8)),
                1
                /* TEXT */
              ),
              vue.createElementVNode(
                "text",
                { class: "device-info" },
                "信号: " + vue.toDisplayString(device.RSSI) + "dBm",
                1
                /* TEXT */
              )
            ], 8, ["onClick"]);
          }),
          128
          /* KEYED_FRAGMENT */
        ))
      ])) : vue.createCommentVNode("v-if", true),
      vue.createCommentVNode(" 原有的充电控制 "),
      $data.connected ? (vue.openBlock(), vue.createElementBlock("view", {
        key: 1,
        class: "card"
      }, [
        vue.createElementVNode("text", { class: "title" }, "充电控制"),
        vue.createElementVNode("view", { class: "control-row" }, [
          vue.createElementVNode("button", {
            class: vue.normalizeClass(["btn", { "btn-active": $data.charging }]),
            onClick: _cache[1] || (_cache[1] = ($event) => $options.startCharge(30)),
            disabled: $data.charging
          }, " 充电30分钟 ", 10, ["disabled"]),
          vue.createElementVNode("button", {
            class: vue.normalizeClass(["btn", { "btn-active": !$data.charging }]),
            onClick: _cache[2] || (_cache[2] = ($event) => $options.stopCharge()),
            disabled: !$data.charging
          }, " 停止充电 ", 10, ["disabled"])
        ]),
        vue.createElementVNode("view", { class: "control-row" }, [
          vue.createElementVNode("button", {
            class: "btn secondary",
            onClick: _cache[3] || (_cache[3] = ($event) => $options.initDevice())
          }, " 初始化设备 "),
          vue.createElementVNode("button", {
            class: "btn secondary",
            onClick: _cache[4] || (_cache[4] = ($event) => $options.changeDeviceName())
          }, " 修改名称 ")
        ])
      ])) : vue.createCommentVNode("v-if", true),
      vue.createCommentVNode(" ✅ 新增：OTA升级界面 "),
      $data.connected ? (vue.openBlock(), vue.createElementBlock("view", {
        key: 2,
        class: "card"
      }, [
        vue.createElementVNode("text", { class: "title" }, "固件升级"),
        vue.createCommentVNode(" 版本信息和升级提示 "),
        $data.deviceVersion ? (vue.openBlock(), vue.createElementBlock("view", {
          key: 0,
          class: "version-info"
        }, [
          vue.createElementVNode(
            "text",
            null,
            "当前版本: " + vue.toDisplayString($data.deviceVersion),
            1
            /* TEXT */
          ),
          $data.latestVersion ? (vue.openBlock(), vue.createElementBlock(
            "text",
            {
              key: 0,
              class: vue.normalizeClass({ "update-available": $data.hasUpdate })
            },
            " 最新版本: " + vue.toDisplayString($data.latestVersion),
            3
            /* TEXT, CLASS */
          )) : vue.createCommentVNode("v-if", true),
          $data.hasUpdate ? (vue.openBlock(), vue.createElementBlock("text", {
            key: 1,
            class: "update-tip"
          }, "有可用更新")) : vue.createCommentVNode("v-if", true)
        ])) : vue.createCommentVNode("v-if", true),
        vue.createCommentVNode(" 升级进度 "),
        $data.otaStatus.isUpgrading ? (vue.openBlock(), vue.createElementBlock("view", {
          key: 1,
          class: "upgrade-progress"
        }, [
          vue.createElementVNode(
            "text",
            null,
            "升级进度: " + vue.toDisplayString($data.otaStatus.progress) + "%",
            1
            /* TEXT */
          ),
          vue.createElementVNode("progress", {
            percent: $data.otaStatus.progress,
            "show-info": "",
            "stroke-width": "6"
          }, null, 8, ["percent"]),
          vue.createElementVNode(
            "text",
            null,
            "已发送: " + vue.toDisplayString($data.otaStatus.sentPackets) + " / " + vue.toDisplayString($data.otaStatus.totalPackets) + " 包",
            1
            /* TEXT */
          )
        ])) : vue.createCommentVNode("v-if", true),
        vue.createCommentVNode(" 操作按钮 "),
        vue.createElementVNode("view", { class: "ota-controls" }, [
          vue.createElementVNode("button", {
            class: "btn",
            onClick: _cache[5] || (_cache[5] = (...args) => _ctx.checkVersion && _ctx.checkVersion(...args)),
            disabled: $data.otaStatus.isUpgrading
          }, " 检查版本 ", 8, ["disabled"]),
          $data.hasUpdate ? (vue.openBlock(), vue.createElementBlock("button", {
            key: 0,
            class: "btn",
            onClick: _cache[6] || (_cache[6] = (...args) => _ctx.startOTAUpgrade && _ctx.startOTAUpgrade(...args)),
            disabled: !$data.hasUpdate || $data.otaStatus.isUpgrading
          }, vue.toDisplayString($data.otaStatus.isUpgrading ? "升级中..." : "开始升级"), 9, ["disabled"])) : vue.createCommentVNode("v-if", true),
          $data.otaStatus.isUpgrading ? (vue.openBlock(), vue.createElementBlock("button", {
            key: 1,
            class: "btn danger",
            onClick: _cache[7] || (_cache[7] = (...args) => _ctx.cancelOTAUpgrade && _ctx.cancelOTAUpgrade(...args))
          }, " 取消升级 ")) : vue.createCommentVNode("v-if", true)
        ]),
        vue.createCommentVNode(" 升级状态提示 "),
        vue.createElementVNode("view", { class: "ota-status" }, [
          $data.otaStatus.isUpgrading ? (vue.openBlock(), vue.createElementBlock("text", {
            key: 0,
            class: "upgrading"
          }, "正在升级，请勿断开设备...")) : vue.createCommentVNode("v-if", true),
          $data.upgradeResult === "success" ? (vue.openBlock(), vue.createElementBlock("text", {
            key: 1,
            class: "success"
          }, "升级成功！")) : vue.createCommentVNode("v-if", true),
          $data.upgradeResult === "failed" ? (vue.openBlock(), vue.createElementBlock("text", {
            key: 2,
            class: "failed"
          }, "升级失败，请重试")) : vue.createCommentVNode("v-if", true)
        ])
      ])) : vue.createCommentVNode("v-if", true),
      vue.createCommentVNode(" 原有的操作面板 "),
      vue.createElementVNode("view", { class: "card" }, [
        vue.createElementVNode("text", { class: "title" }, "设备操作"),
        vue.createElementVNode("view", { class: "control-row" }, [
          vue.createElementVNode("button", {
            class: "btn",
            onClick: _cache[8] || (_cache[8] = ($event) => $options.initBluetooth()),
            disabled: $data.bluetoothAvailable
          }, vue.toDisplayString($data.bluetoothAvailable ? "蓝牙就绪" : "初始化蓝牙"), 9, ["disabled"]),
          vue.createElementVNode("button", {
            class: "btn",
            onClick: _cache[9] || (_cache[9] = ($event) => $options.scanDevices()),
            disabled: !$data.bluetoothAvailable || $data.scanning
          }, vue.toDisplayString($data.scanning ? "扫描中..." : "扫描设备"), 9, ["disabled"])
        ]),
        vue.createElementVNode("button", {
          class: "btn danger",
          onClick: _cache[10] || (_cache[10] = ($event) => $options.disconnectDevice()),
          disabled: !$data.connected
        }, " 断开连接 ", 8, ["disabled"])
      ]),
      vue.createCommentVNode(" 原有的调试信息 "),
      vue.createElementVNode("view", { class: "card" }, [
        vue.createElementVNode("text", { class: "title" }, "调试信息"),
        vue.createElementVNode("scroll-view", {
          "scroll-y": "true",
          class: "log-container"
        }, [
          (vue.openBlock(true), vue.createElementBlock(
            vue.Fragment,
            null,
            vue.renderList($data.logs, (log, index) => {
              return vue.openBlock(), vue.createElementBlock(
                "text",
                {
                  key: index,
                  class: "log-item"
                },
                vue.toDisplayString(log),
                1
                /* TEXT */
              );
            }),
            128
            /* KEYED_FRAGMENT */
          ))
        ]),
        vue.createElementVNode("button", {
          class: "btn small",
          onClick: _cache[11] || (_cache[11] = ($event) => $options.clearLogs())
        }, "清空日志")
      ])
    ]);
  }
  const PagesBluBlu = /* @__PURE__ */ _export_sfc(_sfc_main$2, [["render", _sfc_render$1], ["__scopeId", "data-v-3621e184"], ["__file", "/Users/yons/Desktop/zhengli/xiaochengx/Code/Blu_Charge/pages/Blu/Blu.vue"]]);
  const _sfc_main$1 = {
    data() {
      return {};
    }
  };
  function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
    return vue.openBlock(), vue.createElementBlock("view");
  }
  const PagesMyMy = /* @__PURE__ */ _export_sfc(_sfc_main$1, [["render", _sfc_render], ["__file", "/Users/yons/Desktop/zhengli/xiaochengx/Code/Blu_Charge/pages/My/My.vue"]]);
  __definePage("pages/Blu/Blu", PagesBluBlu);
  __definePage("pages/My/My", PagesMyMy);
  const _sfc_main = {
    onLaunch: function() {
      formatAppLog("log", "at App.vue:4", "App Launch");
    },
    onShow: function() {
      formatAppLog("log", "at App.vue:7", "App Show");
    },
    onHide: function() {
      formatAppLog("log", "at App.vue:10", "App Hide");
    }
  };
  const App = /* @__PURE__ */ _export_sfc(_sfc_main, [["__file", "/Users/yons/Desktop/zhengli/xiaochengx/Code/Blu_Charge/App.vue"]]);
  function createApp() {
    const app = vue.createVueApp(App);
    return {
      app
    };
  }
  const { app: __app__, Vuex: __Vuex__, Pinia: __Pinia__ } = createApp();
  uni.Vuex = __Vuex__;
  uni.Pinia = __Pinia__;
  __app__.provide("__globalStyles", __uniConfig.styles);
  __app__._component.mpType = "app";
  __app__._component.render = () => {
  };
  __app__.mount("#app");
})(Vue);
