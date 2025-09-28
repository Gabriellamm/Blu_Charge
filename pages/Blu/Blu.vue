<!-- 修改后的 Blu.vue -->
<template>
	<view class="container">
    <!-- 原有的设备状态显示 -->
    <view class="card">
      <text class="title">设备状态</text>
      <view class="status-line">
        <text>蓝牙: {{ bluetoothState }}</text>
        <text>连接: {{ connected ? '已连接' : '未连接' }}</text>
      </view>
      <view class="status-line" v-if="connectedDevice">
        <text @longpress="copyDeviceName" class="copyable">设备: {{ connectedDevice.name }}</text>
        <text>信号: {{ connectedDevice.RSSI }}dBm</text>
      </view>
      <view class="status-line">
        <text>充电: {{ chargeStatus }}</text>
        <text>剩余: {{ remainingTime }}分钟</text>
      </view>
    </view>

    <!-- 原有的设备列表 -->
    <view class="card" v-if="devices.length > 0">
      <text class="title">发现设备 ({{ devices.length }})</text>
      <view v-for="device in devices" :key="device.deviceId" 
            class="device-item" @tap="connectDevice(device)">
        <text class="device-name">{{ device.name || '未知设备' }}</text>
        <text class="device-info">ID: {{ device.deviceId.slice(-8) }}</text>
        <text class="device-info">信号: {{ device.RSSI }}dBm</text>
      </view>
    </view>

    <!-- 原有的充电控制 -->
    <view class="card" v-if="connected">
      <text class="title">充电控制</text>
      <view class="control-row">
        <button class="btn" :class="{'btn-active': charging}" 
                @tap="startCharge(30)" :disabled="charging">
          充电30分钟
        </button>
        <button class="btn" :class="{'btn-active': !charging}" 
                @tap="stopCharge()" :disabled="!charging">
          停止充电
        </button>
      </view>
      <view class="control-row">
        <button class="btn secondary" @tap="initDevice()">
          初始化设备
        </button>
        <button class="btn secondary" @tap="changeDeviceName()">
          修改名称
        </button>
      </view>
    </view>

    <!-- ✅ 新增：OTA升级界面 -->
    <view class="card" v-if="connected">
      <text class="title">固件升级</text>
      
      <!-- 版本信息和升级提示 -->
      <view class="version-info" v-if="deviceVersion">
        <text>当前版本: {{ deviceVersion }}</text>
        <text v-if="latestVersion" :class="{'update-available': hasUpdate}">
          最新版本: {{ latestVersion }}
        </text>
        <text v-if="hasUpdate" class="update-tip">有可用更新</text>
      </view>
      
      <!-- 升级进度 -->
      <view class="upgrade-progress" v-if="otaStatus.isUpgrading">
        <text>升级进度: {{ otaStatus.progress }}%</text>
        <progress :percent="otaStatus.progress" show-info stroke-width="6" />
        <text>已发送: {{ otaStatus.sentPackets }} / {{ otaStatus.totalPackets }} 包</text>
      </view>
      
      <!-- 操作按钮 -->
      <view class="ota-controls">
        <button class="btn" @tap="checkVersion" :disabled="otaStatus.isUpgrading">
          检查版本
        </button>
        <button class="btn" @tap="startOTAUpgrade" 
                :disabled="!hasUpdate || otaStatus.isUpgrading"
                v-if="hasUpdate">
          {{ otaStatus.isUpgrading ? '升级中...' : '开始升级' }}
        </button>
        <button class="btn danger" @tap="cancelOTAUpgrade" 
                v-if="otaStatus.isUpgrading">
          取消升级
        </button>
      </view>
      
      <!-- 升级状态提示 -->
      <view class="ota-status">
        <text v-if="otaStatus.isUpgrading" class="upgrading">正在升级，请勿断开设备...</text>
        <text v-if="upgradeResult === 'success'" class="success">升级成功！</text>
        <text v-if="upgradeResult === 'failed'" class="failed">升级失败，请重试</text>
      </view>
    </view>

    <!-- 原有的操作面板 -->
    <view class="card">
      <text class="title">设备操作</text>
      <view class="control-row">
        <button class="btn" @tap="initBluetooth()" 
                :disabled="bluetoothAvailable">
          {{ bluetoothAvailable ? '蓝牙就绪' : '初始化蓝牙' }}
        </button>
        <button class="btn" @tap="scanDevices()" 
                :disabled="!bluetoothAvailable || scanning">
          {{ scanning ? '扫描中...' : '扫描设备' }}
        </button>
      </view>
      <button class="btn danger" @tap="disconnectDevice()" 
              :disabled="!connected">
        断开连接
      </button>
    </view>

    <!-- 原有的调试信息 -->
    <view class="card">
      <text class="title">调试信息</text>
      <scroll-view scroll-y="true" class="log-container">
        <text v-for="(log, index) in logs" :key="index" class="log-item">
          {{ log }}
        </text>
      </scroll-view>
      <button class="btn small" @tap="clearLogs()">清空日志</button>
    </view>
  </view>
</template>

<script>
// ✅ 导入原有的协议处理
import { PROTOCOL, PacketBuilder } from './protocol.js'
// ✅ 新增：导入OTA管理器
import { otaManager } from './ota-upgrade.js'

export default {
  data() {
    return {
			  
      // 原有的蓝牙状态
      bluetoothAvailable: false,
      bluetoothState: '未初始化',
      scanning: false,
      connected: false,
      connectedDevice: null,
      
      // 原有的设备状态
      devices: [],
      chargeStatus: '未充电',
      remainingTime: 0,
      charging: false,
      
      // 原有的蓝牙特征值
      serviceId: '',
      notifyCharId: '',
      writeCharId: '',
      
      // 原有的调试
      logs: [],
      
      // ✅ 新增：OTA相关数据
      deviceVersion: '',          // 设备当前版本
      latestVersion: '',          // 服务器最新版本
      hasUpdate: false,           // 是否有更新
      otaStatus: {                // OTA升级状态
        isUpgrading: false,
        progress: 0,
        totalPackets: 0,
        sentPackets: 0
      },
      upgradeResult: ''           // 升级结果：success/failed
    }
  },

  onLoad() {
    this.addLog('页面加载完成')
    this.initBluetooth()
    
    // ✅ 新增：开始监控OTA状态
    this.monitorOTAStatus()
  },

  methods: {
    // 初始化蓝牙
    async initBluetooth() {
      this.addLog('初始化蓝牙适配器...')
      
      try {
        const res = await new Promise((resolve, reject) => {
          uni.openBluetoothAdapter({
            success: resolve,
            fail: reject
          })
        })
        
        this.addLog('蓝牙适配器打开成功')
        this.bluetoothAvailable = true
        this.bluetoothState = '就绪'
        
        // 监听状态变化
        uni.onBluetoothAdapterStateChange((res) => {
          this.addLog(`蓝牙状态变化: 可用=${res.available}, 搜索中=${res.discovering}`)
          this.bluetoothAvailable = res.available
        })
        
        // 监听设备发现
        uni.onBluetoothDeviceFound(this.onDeviceFound.bind(this))
        
      } catch (err) {
        this.addLog(`蓝牙初始化失败: ${JSON.stringify(err)}`)
        uni.showModal({
          title: '提示',
          content: '请检查手机蓝牙是否开启，并授予蓝牙权限',
          showCancel: false
        })
      }
    },
    
    // 扫描设备
    async scanDevices() {
      if (!this.bluetoothAvailable) {
        uni.showToast({ title: '蓝牙未就绪', icon: 'none' })
        return
      }
    
      this.addLog('开始扫描CJC设备...')
      this.scanning = true
      this.devices = []
    
      try {
        await new Promise((resolve, reject) => {
          uni.startBluetoothDevicesDiscovery({
            // services: [PROTOCOL.SERVICE_UUID],
            allowDuplicatesKey: false,
            success: resolve,
            fail: reject
          })
        })
        
        this.addLog('扫描启动成功')
        
        // 5秒后停止扫描
        setTimeout(() => {
          this.stopScan()
        }, 5000)
        
      } catch (err) {
        this.addLog(`扫描启动失败: ${JSON.stringify(err)}`)
        this.scanning = false
      }
    },
    
    // 停止扫描
    async stopScan() {
      try {
        await new Promise((resolve, reject) => {
          uni.stopBluetoothDevicesDiscovery({
            success: resolve,
            fail: reject
          })
        })
        this.addLog('扫描已停止')
      } catch (err) {
        this.addLog(`停止扫描失败: ${JSON.stringify(err)}`)
      }
      this.scanning = false
    },
    
    // 设备发现回调
    onDeviceFound(res) {
      const cjcDevices = res.devices.filter(device => 
        device.name && device.name.startsWith('CJC')
      )
      
      cjcDevices.forEach(device => {
        if (!this.devices.find(d => d.deviceId === device.deviceId)) {
          this.devices.push(device)
          this.addLog(`发现设备: ${device.name} (${device.RSSI}dBm)`)
        }
      })
    },
    
    // 连接设备
    async connectDevice(device) {
      this.addLog(`连接设备: ${device.name}`)
      
      try {
        // 建立连接
        await new Promise((resolve, reject) => {
          uni.createBLEConnection({
            deviceId: device.deviceId,
            success: resolve,
            fail: reject
          })
        })
        
        this.addLog('物理连接成功')
        this.connected = true
        this.connectedDevice = device
        
        // 获取服务
        await this.getServices(device.deviceId)
        
      } catch (err) {
        this.addLog(`连接失败: ${JSON.stringify(err)}`)
        uni.showToast({ title: '连接失败', icon: 'none' })
      }
    },
    
    // 获取服务
    async getServices(deviceId) {
      try {
        const res = await new Promise((resolve, reject) => {
          uni.getBLEDeviceServices({
            deviceId: deviceId,
            success: resolve,
            fail: reject
          })
        })
        
        // 查找目标服务
        const targetService = res.services.find(s => s.uuid.toUpperCase().includes(PROTOCOL.SERVICE_UUID))
        if (!targetService) {
          throw new Error('未找到目标服务')
        }
        
        this.serviceId = targetService.uuid
        this.addLog(`找到服务: ${targetService.uuid}`)
        
        // 获取特征值
        await this.getCharacteristics(deviceId)
        
      } catch (err) {
        this.addLog(`获取服务失败: ${err.message}`)
      }
    },
    
    // 获取特征值
    async getCharacteristics(deviceId) {
      try {
        const res = await new Promise((resolve, reject) => {
          uni.getBLEDeviceCharacteristics({
            deviceId: deviceId,
            serviceId: this.serviceId,
            success: resolve,
            fail: reject
          })
        })
        
        // 查找特征值
        for (let char of res.characteristics) {
          const uuid = char.uuid.toUpperCase()
          
          if (uuid.includes(PROTOCOL.NOTIFY_CHAR_UUID) && char.properties.notify) {
            this.notifyCharId = char.uuid
            this.addLog(`找到Notify特征: ${char.uuid}`)
          }
          
          if (uuid.includes(PROTOCOL.WRITE_CHAR_UUID) && char.properties.write) {
            this.writeCharId = char.uuid
            this.addLog(`找到Write特征: ${char.uuid}`)
          }
        }
        
        if (!this.notifyCharId || !this.writeCharId) {
          throw new Error('未找到必要的特征值')
        }
        
        // 启用通知
        await this.enableNotify(deviceId)
        
      } catch (err) {
        this.addLog(`获取特征值失败: ${err.message}`)
      }
    },
    
    // 启用通知
    async enableNotify(deviceId) {
      try {
        await new Promise((resolve, reject) => {
          uni.notifyBLECharacteristicValueChange({
            deviceId: deviceId,
            serviceId: this.serviceId,
            characteristicId: this.notifyCharId,
            state: true,
            success: resolve,
            fail: reject
          })
        })
        
        this.addLog('通知启用成功')
        
        // 监听设备数据
        uni.onBLECharacteristicValueChange(this.onDeviceDataReceived.bind(this))
        
        // 连接完成，发送初始化命令
        setTimeout(() => {
          this.initDevice()
        }, 500)
        
      } catch (err) {
        this.addLog(`启用通知失败: ${JSON.stringify(err)}`)
      }
    },
    
    // 接收设备数据
    onDeviceDataReceived(res) {
      try {
        const hexData = PacketBuilder.ab2hex(res.value)
        this.addLog(`收到设备数据: ${hexData}`)
        
        const parsedData = PacketBuilder.parseDeviceResponse(res.value)
        this.handleDeviceCommand(parsedData.cmdId, parsedData.payload)
        
      } catch (err) {
        this.addLog(`数据解析错误: ${err.message}`)
      }
    },
    
    // 处理设备命令
    handleDeviceCommand(cmdId, payload) {
      const dataView = new DataView(payload.buffer)
      
      switch (cmdId) {
        case PROTOCOL.CMD_CHARGE_STATUS: // 0x11 充电状态反馈
          const status = dataView.getUint8(0)
          const remainingTime = dataView.getUint16(1, false)
          
          this.chargeStatus = status === 1 ? '充电中' : '未充电'
          this.remainingTime = remainingTime
          this.charging = status === 1
          
          this.addLog(`充电状态: ${this.chargeStatus}, 剩余: ${remainingTime}分钟`)
          break
          
        case PROTOCOL.CMD_INIT_RESULT: // 0x21 初始化结果
          const initStatus = dataView.getUint8(0)
          this.addLog(`设备初始化: ${initStatus === 1 ? '成功' : '失败'}`)
          
          if (initStatus === 1) {
            uni.showToast({ title: '初始化成功' })
          } else {
            uni.showToast({ title: '初始化失败', icon: 'none' })
          }
          break
          
        case PROTOCOL.CMD_CHANGE_NAME_RESULT: // 0x31 改名结果
          const nameStatus = dataView.getUint8(0)
          const resultMessage = nameStatus === 1 ? '成功' : '失败'
          this.addLog(`改名结果: ${resultMessage}`)
          
          // 显示用户界面提示
          uni.showToast({
            title: `修改名称${resultMessage}`,
            icon: nameStatus === 1 ? 'success' : 'none'
          })
          
          // 如果改名成功，断开重连后会自动更新名称
          break
          
        default:
          this.addLog(`未知命令: 0x${cmdId.toString(16)}`)
      }
    },
    
    // 开始充电
    async startCharge(duration) {
      if (!this.connected) {
        uni.showToast({ title: '设备未连接', icon: 'none' })
        return
      }
      
      try {
        const command = PacketBuilder.buildChargeCommand(1, duration) // 1=开启
        await this.sendCommand(command)
        this.addLog(`开始充电: ${duration}分钟`)
        
      } catch (err) {
        this.addLog(`发送充电命令失败: ${err.message}`)
      }
    },
    
    // 停止充电
    async stopCharge() {
      if (!this.connected) {
        return
      }
      
      try {
        const command = PacketBuilder.buildChargeCommand(0, 0) // 0=关闭
        await this.sendCommand(command)
        this.addLog('停止充电')
        
      } catch (err) {
        this.addLog(`发送停止命令失败: ${err.message}`)
      }
    },
    
    // 初始化设备
    async initDevice() {
      if (!this.connected) {
        return
      }
      
      try {
        // 使用设备名称作为鉴权码（如：CJC000001）
        const authCode = this.connectedDevice.name || 'CJC000001'
        const command = PacketBuilder.buildInitCommand(authCode, 10, 5) // 10分钟断连，5分钟无负载关闭
        
        await this.sendCommand(command)
        this.addLog(`发送初始化命令: ${authCode}`)
        
      } catch (err) {
        this.addLog(`发送初始化命令失败: ${err.message}`)
      }
    },
    
    // 修改设备名称
    async changeDeviceName() {
      if (!this.connected) {
        return
      }
      
      uni.showModal({
        title: '修改设备名称',
        content: '9字符以内',
        editable: true,
        placeholderText: 'CJC000002',
        success: async (res) => {
          if (res.confirm && res.content) {
            const newName = res.content.padEnd(9, '\0').slice(0, 9)
            
            try {
              const command = PacketBuilder.buildChangeNameCommand(newName)
              await this.sendCommand(command)
              this.addLog(`发送改名命令: ${newName}`)
              
            } catch (err) {
              this.addLog(`发送改名命令失败: ${err.message}`)
            }
          }
        }
      })
    },
    
    // 发送命令到设备
    async sendCommand(commandData) {
      if (!this.connected || !this.writeCharId) {
        throw new Error('设备未连接或未找到写入特征')
      }
      
      // 分包发送
      const packets = PacketBuilder.splitPackets(commandData)
      this.addLog(`分包发送: ${packets.length}包`)
      
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
            })
          })
          
          // 包间延迟，避免发送过快
          if (i < packets.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 20))
          }
        }
        
        this.addLog(`命令发送完成: ${PacketBuilder.ab2hex(commandData)}`)
      } catch (err) {
        this.addLog(`发送命令失败: ${err.message}`)
        throw err
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
                })
              })
              
              this.addLog('设备已断开')
              this.connected = false
              this.connectedDevice = null
              this.charging = false
              this.chargeStatus = '未充电'
              this.remainingTime = 0
              
            } catch (err) {
              this.addLog(`断开连接失败: ${JSON.stringify(err)}`)
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
                  title: '设备名称已复制',
                  icon: 'success'
                })
                this.addLog(`已复制设备名称: ${this.connectedDevice.name}`)
              }
            })
          }
        },
        
        // 工具函数
        addLog(message) {
          const timestamp = new Date().toLocaleTimeString()
          const logMessage = `[${timestamp}] ${message}`
          // 添加到日志数组
          this.logs.unshift(logMessage)
          // 同步输出到 HBuilderX 控制台
          console.log(logMessage)
          // 限制日志最大长度
          if (this.logs.length > 50) {
            this.logs.pop()
          }
        },
    
        clearLogs() {
          this.logs = []
        }
      },
    // ✅ 新增：OTA相关方法
    
    /**
     * 检查设备版本
     */
    async checkVersion() {
      if (!this.connected) {
        uni.showToast({ title: '设备未连接', icon: 'none' })
        return
      }
      
      try {
        uni.showLoading({ title: '检查版本中...' })
        
        // 使用Blu.vue中已经建立的连接信息
        this.deviceVersion = await otaManager.checkFirmwareVersion(
          this.connectedDevice.deviceId,
          this.serviceId, 
          this.writeCharId
        )
        
        // 从服务器获取最新版本信息
        await this.fetchLatestVersion()
        
        this.hasUpdate = this.deviceVersion !== this.latestVersion
        
        uni.hideLoading()
        uni.showToast({ 
          title: this.hasUpdate ? '发现新版本' : '已是最新版本',
          icon: 'none'
        })
        
      } catch (error) {
        uni.hideLoading()
        uni.showToast({ title: '版本检查失败', icon: 'none' })
        console.error('版本检查失败:', error)
      }
    },
    
    /**
     * 开始OTA升级
     */
    async startOTAUpgrade() {
      if (!this.hasUpdate) {
        uni.showToast({ title: '没有可用更新', icon: 'none' })
        return
      }
      
      if (!this.connected || !this.connectedDevice) {
        uni.showToast({ title: '设备未连接', icon: 'none' })
        return
      }
      
      try {
        // 确认升级
        const { confirm } = await uni.showModal({
          title: '固件升级',
          content: '升级过程中请勿断开设备连接，确保设备电量充足。是否继续？',
          confirmText: '开始升级',
          cancelText: '取消'
        })
        
        if (!confirm) return
        
        uni.showLoading({ title: '准备升级...' })
        
        // 设置进度回调
        otaManager.setProgressCallback((progress) => {
          this.otaStatus.progress = progress
          this.addLog(`OTA升级进度: ${progress}%`)
        })
        
        // ✅ 关键：使用Blu.vue中已经建立的设备连接信息
        const deviceInfo = {
          deviceId: this.connectedDevice.deviceId,
          name: this.connectedDevice.name,
          serviceId: this.serviceId,
          characteristicId: this.writeCharId
        }
        
        // 开始升级流程
        await otaManager.startOTAUpgrade(
          deviceInfo,
          'https://your-server.com/firmware.bin' // 固件下载地址
        )
        
        this.upgradeResult = 'success'
        uni.hideLoading()
        uni.showToast({ title: '升级成功！', icon: 'success' })
        this.addLog('OTA升级成功')
        
        // 升级成功后重新检查版本
        setTimeout(() => {
          this.checkVersion()
        }, 2000)
        
      } catch (error) {
        uni.hideLoading()
        this.upgradeResult = 'failed'
        uni.showToast({ title: '升级失败: ' + error.message, icon: 'none' })
        this.addLog('OTA升级失败: ' + error.message)
        console.error('OTA升级失败:', error)
      }
    },
    
    /**
     * 取消OTA升级
     */
    cancelOTAUpgrade() {
      uni.showModal({
        title: '取消升级',
        content: '确定要取消固件升级吗？这可能导致设备异常。',
        success: ({ confirm }) => {
          if (confirm) {
            // 这里应该调用OTA管理器的取消方法
            this.otaStatus.isUpgrading = false
            this.upgradeResult = 'cancelled'
            uni.showToast({ title: '升级已取消', icon: 'none' })
            this.addLog('OTA升级已取消')
          }
        }
      })
    },
    
    /**
     * 从服务器获取最新版本信息
     */
    async fetchLatestVersion() {
      // 模拟网络请求
      return new Promise((resolve) => {
        setTimeout(() => {
          this.latestVersion = 'CC1_V1.1' // 模拟新版本
          resolve()
        }, 1000)
      })
    },
    
    /**
     * 监听OTA状态变化
     */
    monitorOTAStatus() {
      // 定期检查OTA状态
      setInterval(() => {
        const status = otaManager.getUpgradeStatus()
        this.otaStatus = { ...this.otaStatus, ...status }
      }, 500)
    },
    
    // ✅ 保留原有的工具方法
    addLog(message) {
      // 修复时间戳格式，确保格式为 [HH:MM:SS]
      const now = new Date()
      const hours = now.getHours().toString().padStart(2, '0')
      const minutes = now.getMinutes().toString().padStart(2, '0')
      const seconds = now.getSeconds().toString().padStart(2, '0')
      const timestamp = `${hours}:${minutes}:${seconds}`
      
      const logMessage = `[${timestamp}] ${message}`
      this.logs.unshift(logMessage)
      if (this.logs.length > 50) this.logs.pop()
      // 同步打印到控制台
      console.log(logMessage)
    },

    clearLogs() {
      this.logs = []
    }
}
</script>

<style scoped>
/* 保留原有的所有样式 */

.container {
  padding: 20rpx;
  min-height: 100vh;
}

.card {
  background: white;
  border-radius: 15rpx;
  padding: 30rpx;
  margin: 20rpx 0;
  box-shadow: 0 2rpx 10rpx rgba(0,0,0,0.1);
}

.title {
  font-size: 36rpx;
  font-weight: bold;
  margin-bottom: 20rpx;
  display: block;
  color: #333;
}

.status-line {
  display: flex;
  justify-content: space-between;
  padding: 15rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}

.copyable {
  color: #007AFF;
  text-decoration: underline;
  text-decoration-style: dotted;
}

.status-line:last-child {
  border-bottom: none;
}

.device-item {
  background: #f8f9fa;
  border-radius: 10rpx;
  padding: 25rpx;
  margin: 15rpx 0;
  border-left: 8rpx solid #007AFF;
}

.device-name {
  font-size: 32rpx;
  font-weight: bold;
  display: block;
  color: #007AFF;
}

.device-info {
  font-size: 24rpx;
  color: #666;
  display: block;
  margin-top: 8rpx;
}

.control-row {
  display: flex;
  gap: 20rpx;
  margin: 20rpx 0;
}

.btn {
  flex: 1;
  background: #007AFF;
  color: white;
  border-radius: 10rpx;
  padding: 20rpx;
  text-align: center;
  font-size: 28rpx;
  border: none;
}

.btn:active {
  background: #0056CC;
}

.btn:disabled {
  background: #CCCCCC;
  color: #666666;
}

.btn-active {
  background: #34C759;
}

.btn-secondary {
  background: #FF9500;
}

.btn-danger {
  background: #FF3B30;
}

.btn-small {
  padding: 15rpx;
  font-size: 24rpx;
}

.log-container {
  max-height: 300rpx;
  background: #f8f8f8;
  border-radius: 10rpx;
  padding: 20rpx;
  margin-bottom: 20rpx;
}

.log-item {
  font-size: 22rpx;
  font-family: 'Courier New', monospace;
  display: block;
  margin: 5rpx 0;
  color: #333;
  line-height: 1.4;
}

/* ✅ 新增：OTA相关样式 */
.version-info {
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}

.version-info text {
  display: block;
  margin: 10rpx 0;
  font-size: 28rpx;
}

.update-available {
  color: #FF9500;
  font-weight: bold;
}

.update-tip {
  color: #34C759;
  font-size: 24rpx;
}

.upgrade-progress {
  padding: 30rpx 0;
  text-align: center;
}

.upgrade-progress text {
  display: block;
  margin: 10rpx 0;
  font-size: 26rpx;
}

.ota-controls {
  display: flex;
  gap: 20rpx;
  margin: 30rpx 0;
}

.ota-status {
  text-align: center;
  padding: 20rpx 0;
}

.upgrading {
  color: #007AFF;
  font-weight: bold;
}

.success {
  color: #34C759;
  font-weight: bold;
}

.failed {
  color: #FF3B30;
  font-weight: bold;
}

/* 进度条样式调整 */
progress {
  width: 100%;
  margin: 20rpx 0;
}
</style>