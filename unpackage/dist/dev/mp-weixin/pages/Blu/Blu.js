"use strict";
const common_vendor = require("../../common/vendor.js");
const pages_Blu_protocol = require("./protocol.js");
const pages_Blu_otaUpgrade = require("./ota-upgrade.js");
const _sfc_main = {
  data() {
    return {
      // // 蓝牙状态
      // bluetoothAvailable: false,
      // bluetoothState: '未初始化',
      // scanning: false,
      // connected: false,
      // connectedDevice: null,
      // // 设备状态
      // devices: [],
      // chargeStatus: '未充电',
      // remainingTime: 0,
      // charging: false,
      // // 蓝牙特征值
      // serviceId: '',
      // notifyCharId: '',
      // writeCharId: '',
      // // 调试
      // logs: [],
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
          common_vendor.index.openBluetoothAdapter({
            success: resolve,
            fail: reject
          });
        });
        this.addLog("蓝牙适配器打开成功");
        this.bluetoothAvailable = true;
        this.bluetoothState = "就绪";
        common_vendor.index.onBluetoothAdapterStateChange((res2) => {
          this.addLog(`蓝牙状态变化: 可用=${res2.available}, 搜索中=${res2.discovering}`);
          this.bluetoothAvailable = res2.available;
        });
        common_vendor.index.onBluetoothDeviceFound(this.onDeviceFound.bind(this));
      } catch (err) {
        this.addLog(`蓝牙初始化失败: ${JSON.stringify(err)}`);
        common_vendor.index.showModal({
          title: "提示",
          content: "请检查手机蓝牙是否开启，并授予蓝牙权限",
          showCancel: false
        });
      }
    },
    // 扫描设备
    async scanDevices() {
      if (!this.bluetoothAvailable) {
        common_vendor.index.showToast({ title: "蓝牙未就绪", icon: "none" });
        return;
      }
      this.addLog("开始扫描CJC设备...");
      this.scanning = true;
      this.devices = [];
      try {
        await new Promise((resolve, reject) => {
          common_vendor.index.startBluetoothDevicesDiscovery({
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
          common_vendor.index.stopBluetoothDevicesDiscovery({
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
          common_vendor.index.createBLEConnection({
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
        common_vendor.index.showToast({ title: "连接失败", icon: "none" });
      }
    },
    // 获取服务
    async getServices(deviceId) {
      try {
        const res = await new Promise((resolve, reject) => {
          common_vendor.index.getBLEDeviceServices({
            deviceId,
            success: resolve,
            fail: reject
          });
        });
        const targetService = res.services.find((s) => s.uuid.toUpperCase().includes(pages_Blu_protocol.PROTOCOL.SERVICE_UUID));
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
          common_vendor.index.getBLEDeviceCharacteristics({
            deviceId,
            serviceId: this.serviceId,
            success: resolve,
            fail: reject
          });
        });
        for (let char of res.characteristics) {
          const uuid = char.uuid.toUpperCase();
          if (uuid.includes(pages_Blu_protocol.PROTOCOL.NOTIFY_CHAR_UUID) && char.properties.notify) {
            this.notifyCharId = char.uuid;
            this.addLog(`找到Notify特征: ${char.uuid}`);
          }
          if (uuid.includes(pages_Blu_protocol.PROTOCOL.WRITE_CHAR_UUID) && char.properties.write) {
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
          common_vendor.index.notifyBLECharacteristicValueChange({
            deviceId,
            serviceId: this.serviceId,
            characteristicId: this.notifyCharId,
            state: true,
            success: resolve,
            fail: reject
          });
        });
        this.addLog("通知启用成功");
        common_vendor.index.onBLECharacteristicValueChange(this.onDeviceDataReceived.bind(this));
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
        const hexData = pages_Blu_protocol.PacketBuilder.ab2hex(res.value);
        this.addLog(`收到设备数据: ${hexData}`);
        const parsedData = pages_Blu_protocol.PacketBuilder.parseDeviceResponse(res.value);
        this.handleDeviceCommand(parsedData.cmdId, parsedData.payload);
      } catch (err) {
        this.addLog(`数据解析错误: ${err.message}`);
      }
    },
    // 处理设备命令
    handleDeviceCommand(cmdId, payload) {
      const dataView = new DataView(payload.buffer);
      switch (cmdId) {
        case pages_Blu_protocol.PROTOCOL.CMD_CHARGE_STATUS:
          const status = dataView.getUint8(0);
          const remainingTime = dataView.getUint16(1, false);
          this.chargeStatus = status === 1 ? "充电中" : "未充电";
          this.remainingTime = remainingTime;
          this.charging = status === 1;
          this.addLog(`充电状态: ${this.chargeStatus}, 剩余: ${remainingTime}分钟`);
          break;
        case pages_Blu_protocol.PROTOCOL.CMD_INIT_RESULT:
          const initStatus = dataView.getUint8(0);
          this.addLog(`设备初始化: ${initStatus === 1 ? "成功" : "失败"}`);
          if (initStatus === 1) {
            common_vendor.index.showToast({ title: "初始化成功" });
          } else {
            common_vendor.index.showToast({ title: "初始化失败", icon: "none" });
          }
          break;
        case pages_Blu_protocol.PROTOCOL.CMD_CHANGE_NAME_RESULT:
          const nameStatus = dataView.getUint8(0);
          const resultMessage = nameStatus === 1 ? "成功" : "失败";
          this.addLog(`改名结果: ${resultMessage}`);
          common_vendor.index.showToast({
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
        common_vendor.index.showToast({ title: "设备未连接", icon: "none" });
        return;
      }
      try {
        const command = pages_Blu_protocol.PacketBuilder.buildChargeCommand(1, duration);
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
        const command = pages_Blu_protocol.PacketBuilder.buildChargeCommand(0, 0);
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
        const command = pages_Blu_protocol.PacketBuilder.buildInitCommand(authCode, 10, 5);
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
      common_vendor.index.showModal({
        title: "修改设备名称",
        content: "9字符以内",
        editable: true,
        placeholderText: "CJC000002",
        success: async (res) => {
          if (res.confirm && res.content) {
            const newName = res.content.padEnd(9, "\0").slice(0, 9);
            try {
              const command = pages_Blu_protocol.PacketBuilder.buildChangeNameCommand(newName);
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
      const packets = pages_Blu_protocol.PacketBuilder.splitPackets(commandData);
      this.addLog(`分包发送: ${packets.length}包`);
      try {
        for (let i = 0; i < packets.length; i++) {
          await new Promise((resolve, reject) => {
            common_vendor.index.writeBLECharacteristicValue({
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
        this.addLog(`命令发送完成: ${pages_Blu_protocol.PacketBuilder.ab2hex(commandData)}`);
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
            common_vendor.index.closeBLEConnection({
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
        common_vendor.index.setClipboardData({
          data: this.connectedDevice.name,
          success: () => {
            common_vendor.index.showToast({
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
      this.logs.unshift(`[${timestamp}] ${message}`);
      if (this.logs.length > 50)
        this.logs.pop();
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
      common_vendor.index.showToast({ title: "设备未连接", icon: "none" });
      return;
    }
    try {
      common_vendor.index.showLoading({ title: "检查版本中..." });
      this.deviceVersion = await pages_Blu_otaUpgrade.otaManager.checkFirmwareVersion(
        this.connectedDevice.deviceId,
        this.serviceId,
        this.writeCharId
      );
      await this.fetchLatestVersion();
      this.hasUpdate = this.deviceVersion !== this.latestVersion;
      common_vendor.index.hideLoading();
      common_vendor.index.showToast({
        title: this.hasUpdate ? "发现新版本" : "已是最新版本",
        icon: "none"
      });
    } catch (error) {
      common_vendor.index.hideLoading();
      common_vendor.index.showToast({ title: "版本检查失败", icon: "none" });
      common_vendor.index.__f__("error", "at pages/Blu/Blu.vue:690", "版本检查失败:", error);
    }
  },
  /**
   * 开始OTA升级
   */
  async startOTAUpgrade() {
    if (!this.hasUpdate) {
      common_vendor.index.showToast({ title: "没有可用更新", icon: "none" });
      return;
    }
    if (!this.connected || !this.connectedDevice) {
      common_vendor.index.showToast({ title: "设备未连接", icon: "none" });
      return;
    }
    try {
      const { confirm } = await common_vendor.index.showModal({
        title: "固件升级",
        content: "升级过程中请勿断开设备连接，确保设备电量充足。是否继续？",
        confirmText: "开始升级",
        cancelText: "取消"
      });
      if (!confirm)
        return;
      common_vendor.index.showLoading({ title: "准备升级..." });
      pages_Blu_otaUpgrade.otaManager.setProgressCallback((progress) => {
        this.otaStatus.progress = progress;
        this.addLog(`OTA升级进度: ${progress}%`);
      });
      const deviceInfo = {
        deviceId: this.connectedDevice.deviceId,
        name: this.connectedDevice.name,
        serviceId: this.serviceId,
        characteristicId: this.writeCharId
      };
      await pages_Blu_otaUpgrade.otaManager.startOTAUpgrade(
        deviceInfo,
        "https://your-server.com/firmware.bin"
        // 固件下载地址
      );
      this.upgradeResult = "success";
      common_vendor.index.hideLoading();
      common_vendor.index.showToast({ title: "升级成功！", icon: "success" });
      this.addLog("OTA升级成功");
      setTimeout(() => {
        this.checkVersion();
      }, 2e3);
    } catch (error) {
      common_vendor.index.hideLoading();
      this.upgradeResult = "failed";
      common_vendor.index.showToast({ title: "升级失败: " + error.message, icon: "none" });
      this.addLog("OTA升级失败: " + error.message);
      common_vendor.index.__f__("error", "at pages/Blu/Blu.vue:756", "OTA升级失败:", error);
    }
  },
  /**
   * 取消OTA升级
   */
  cancelOTAUpgrade() {
    common_vendor.index.showModal({
      title: "取消升级",
      content: "确定要取消固件升级吗？这可能导致设备异常。",
      success: ({ confirm }) => {
        if (confirm) {
          this.otaStatus.isUpgrading = false;
          this.upgradeResult = "cancelled";
          common_vendor.index.showToast({ title: "升级已取消", icon: "none" });
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
      const status = pages_Blu_otaUpgrade.otaManager.getUpgradeStatus();
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
    common_vendor.index.__f__("log", "at pages/Blu/Blu.vue:816", logMessage);
  },
  clearLogs() {
    this.logs = [];
  }
};
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  return common_vendor.e({
    a: common_vendor.t($data.bluetoothState),
    b: common_vendor.t($data.connected ? "已连接" : "未连接"),
    c: $data.connectedDevice
  }, $data.connectedDevice ? {
    d: common_vendor.t($data.connectedDevice.name),
    e: common_vendor.o((...args) => $options.copyDeviceName && $options.copyDeviceName(...args)),
    f: common_vendor.t($data.connectedDevice.RSSI)
  } : {}, {
    g: common_vendor.t($data.chargeStatus),
    h: common_vendor.t($data.remainingTime),
    i: $data.devices.length > 0
  }, $data.devices.length > 0 ? {
    j: common_vendor.t($data.devices.length),
    k: common_vendor.f($data.devices, (device, k0, i0) => {
      return {
        a: common_vendor.t(device.name || "未知设备"),
        b: common_vendor.t(device.deviceId.slice(-8)),
        c: common_vendor.t(device.RSSI),
        d: device.deviceId,
        e: common_vendor.o(($event) => $options.connectDevice(device), device.deviceId)
      };
    })
  } : {}, {
    l: $data.connected
  }, $data.connected ? {
    m: $data.charging ? 1 : "",
    n: common_vendor.o(($event) => $options.startCharge(30)),
    o: $data.charging,
    p: !$data.charging ? 1 : "",
    q: common_vendor.o(($event) => $options.stopCharge()),
    r: !$data.charging,
    s: common_vendor.o(($event) => $options.initDevice()),
    t: common_vendor.o(($event) => $options.changeDeviceName())
  } : {}, {
    v: $data.connected
  }, $data.connected ? common_vendor.e({
    w: $data.deviceVersion
  }, $data.deviceVersion ? common_vendor.e({
    x: common_vendor.t($data.deviceVersion),
    y: $data.latestVersion
  }, $data.latestVersion ? {
    z: common_vendor.t($data.latestVersion),
    A: $data.hasUpdate ? 1 : ""
  } : {}, {
    B: $data.hasUpdate
  }, $data.hasUpdate ? {} : {}) : {}, {
    C: $data.otaStatus.isUpgrading
  }, $data.otaStatus.isUpgrading ? {
    D: common_vendor.t($data.otaStatus.progress),
    E: $data.otaStatus.progress,
    F: common_vendor.t($data.otaStatus.sentPackets),
    G: common_vendor.t($data.otaStatus.totalPackets)
  } : {}, {
    H: common_vendor.o((...args) => _ctx.checkVersion && _ctx.checkVersion(...args)),
    I: $data.otaStatus.isUpgrading,
    J: $data.hasUpdate
  }, $data.hasUpdate ? {
    K: common_vendor.t($data.otaStatus.isUpgrading ? "升级中..." : "开始升级"),
    L: common_vendor.o((...args) => _ctx.startOTAUpgrade && _ctx.startOTAUpgrade(...args)),
    M: !$data.hasUpdate || $data.otaStatus.isUpgrading
  } : {}, {
    N: $data.otaStatus.isUpgrading
  }, $data.otaStatus.isUpgrading ? {
    O: common_vendor.o((...args) => _ctx.cancelOTAUpgrade && _ctx.cancelOTAUpgrade(...args))
  } : {}, {
    P: $data.otaStatus.isUpgrading
  }, $data.otaStatus.isUpgrading ? {} : {}, {
    Q: $data.upgradeResult === "success"
  }, $data.upgradeResult === "success" ? {} : {}, {
    R: $data.upgradeResult === "failed"
  }, $data.upgradeResult === "failed" ? {} : {}) : {}, {
    S: common_vendor.t($data.bluetoothAvailable ? "蓝牙就绪" : "初始化蓝牙"),
    T: common_vendor.o(($event) => $options.initBluetooth()),
    U: $data.bluetoothAvailable,
    V: common_vendor.t($data.scanning ? "扫描中..." : "扫描设备"),
    W: common_vendor.o(($event) => $options.scanDevices()),
    X: !$data.bluetoothAvailable || $data.scanning,
    Y: common_vendor.o(($event) => $options.disconnectDevice()),
    Z: !$data.connected,
    aa: common_vendor.f($data.logs, (log, index, i0) => {
      return {
        a: common_vendor.t(log),
        b: index
      };
    }),
    ab: common_vendor.o(($event) => $options.clearLogs())
  });
}
const MiniProgramPage = /* @__PURE__ */ common_vendor._export_sfc(_sfc_main, [["render", _sfc_render], ["__scopeId", "data-v-3621e184"]]);
wx.createPage(MiniProgramPage);
//# sourceMappingURL=../../../.sourcemap/mp-weixin/pages/Blu/Blu.js.map
