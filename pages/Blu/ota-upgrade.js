// OTA升级相关常量
export const OTA_PROTOCOL = {
  // OTA服务UUID（根据文档第6页）
  OTA_SERVICE_UUID: 'TELINK_SPP_DATA_OTA',
  
  // OTA命令操作码（文档第6页表格）
  CMD_OTA_VERSION: 0xFF00,    // 获取版本
  CMD_OTA_START: 0xFF01,      // 开始升级
  CMD_OTA_END: 0xFF02,        // 结束升级
  
  // OTA数据包格式（文档第7页）
  OTA_PACKET_SIZE: 20,        // 每包20字节
  DATA_CHUNK_SIZE: 16,        // 每包数据部分16字节
  ADR_INDEX_SIZE: 2,          // 地址索引2字节
  CRC16_SIZE: 2,              // CRC校验2字节
}

// OTA升级管理器
export class OTAUpgradeManager {
  constructor() {
    this.isUpgrading = false
    this.currentProgress = 0
    this.totalPackets = 0
    this.sentPackets = 0
    this.firmwareData = null
    this.deviceId = null
    this.serviceId = null
    this.characteristicId = null
  }

  /**
   * 检查设备固件版本（文档3.1.7.1）
   */
  async checkFirmwareVersion(deviceId, serviceId, characteristicId) {
    try {
      // 发送获取版本命令（文档第6页：CMD_OTA_VERSION）
      const versionCommand = this.buildOTACommand(OTA_PROTOCOL.CMD_OTA_VERSION, new ArrayBuffer(2))
      
      await this.sendOTACommand(deviceId, serviceId, characteristicId, versionCommand)
      
      // 这里需要监听设备返回的版本信息
      // 实际实现中需要设置回调来处理版本信息
      return await this.waitForVersionResponse()
      
    } catch (error) {
      console.error('检查固件版本失败:', error)
      throw error
    }
  }

  /**
   * 开始OTA升级流程（文档3.1.7.2）
   */
  async startOTAUpgrade(deviceInfo, firmwareUrl) {
    if (this.isUpgrading) {
      throw new Error('正在升级中，请等待完成')
    }

    try {
      this.isUpgrading = true
      this.currentProgress = 0
      
      // 1. 从服务器下载固件文件（准备阶段）
      this.firmwareData = await this.downloadFirmware(firmwareUrl)
      
      // 2. 连接OTA服务
      await this.connectOTAService(deviceInfo)
      
      // 3. 发送开始升级命令（启动阶段）
      await this.sendStartCommand()
      
      // 4. 传输固件数据（数据传输阶段）
      await this.transmitFirmwareData()
      
      // 5. 发送结束命令（结束阶段）
      await this.sendEndCommand()
      
      // 6. 等待设备重启并验证
      await this.verifyUpgrade()
      
      return true
      
    } catch (error) {
      console.error('OTA升级失败:', error)
      this.isUpgrading = false
      throw error
    } finally {
      this.isUpgrading = false
    }
  }

  /**
   * 下载固件文件（文档第7页：从服务器中读取升级固件文件）
   */
  async downloadFirmware(firmwareUrl) {
    return new Promise((resolve, reject) => {
      // 使用uni-app的网络请求下载固件
      uni.downloadFile({
        url: firmwareUrl,
        success: (res) => {
          if (res.statusCode === 200) {
            // 读取文件内容
            uni.getFileSystemManager().readFile({
              filePath: res.tempFilePath,
              success: (fileRes) => {
                const firmware = new Uint8Array(fileRes.data)
                console.log(`固件下载成功，大小: ${firmware.length} 字节`)
                resolve(firmware)
              },
              fail: reject
            })
          } else {
            reject(new Error(`下载失败，状态码: ${res.statusCode}`))
          }
        },
        fail: reject
      })
    })
  }

  /**
   * 连接OTA服务（切换到OTA专用的蓝牙服务）
   */
  async connectOTAService(deviceInfo) {
    // 保存设备信息用于后续通信
    this.deviceId = deviceInfo.deviceId
    
    // 发现OTA服务
    const services = await this.discoverServices(deviceInfo.deviceId)
    const otaService = services.find(s => 
      s.uuid.toLowerCase().includes(OTA_PROTOCOL.OTA_SERVICE_UUID.toLowerCase())
    )
    
    if (!otaService) {
      throw new Error('未找到OTA服务')
    }
    
    this.serviceId = otaService.uuid
    
    // 发现OTA特征值
    const characteristics = await this.discoverCharacteristics(deviceInfo.deviceId, otaService.uuid)
    const writeCharacteristic = characteristics.find(c => c.properties.write)
    
    if (!writeCharacteristic) {
      throw new Error('未找到OTA写入特征值')
    }
    
    this.characteristicId = writeCharacteristic.uuid
  }

  /**
   * 发送开始升级命令（文档第7页：CMD_OTA_START）
   */
  async sendStartCommand() {
    // 构建开始命令：2字节Opcode + 2字节保留字段
    const startCommand = this.buildOTACommand(OTA_PROTOCOL.CMD_OTA_START, new ArrayBuffer(2))
    await this.sendOTACommand(this.deviceId, this.serviceId, this.characteristicId, startCommand)
    console.log('OTA开始命令发送成功')
  }

  /**
   * 传输固件数据（核心功能 - 文档第7页分片传输）
   */
  async transmitFirmwareData() {
    const firmware = this.firmwareData
    this.totalPackets = Math.ceil(firmware.length / OTA_PROTOCOL.DATA_CHUNK_SIZE)
    this.sentPackets = 0

    console.log(`开始传输固件，总包数: ${this.totalPackets}`)

    // 分批发送，每50包更新一次进度
    const BATCH_SIZE = 50
    
    for (let batchStart = 0; batchStart < this.totalPackets; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, this.totalPackets)
      
      // 并行发送当前批次的所有包
      const promises = []
      for (let i = batchStart; i < batchEnd; i++) {
        promises.push(this.sendFirmwarePacket(i))
      }
      
      await Promise.all(promises)
      
      // 更新进度（文档第7页：每发送50个数据包更新一次进度条）
      this.updateProgress(batchEnd)
      
      // 短暂延迟，避免发送过快
      await this.delay(100)
    }
  }

  /**
   * 发送单个固件数据包（文档第7页构造OTA数据包）
   */
  async sendFirmwarePacket(packetIndex) {
    const firmware = this.firmwareData
    
    // 计算数据块的起始和结束位置
    const start = packetIndex * OTA_PROTOCOL.DATA_CHUNK_SIZE
    const end = Math.min(start + OTA_PROTOCOL.DATA_CHUNK_SIZE, firmware.length)
    
    // 获取数据块
    let chunk = firmware.slice(start, end)
    
    // 如果数据不足16字节，用0xFF填充（文档第8页）
    if (chunk.length < OTA_PROTOCOL.DATA_CHUNK_SIZE) {
      const paddedChunk = new Uint8Array(OTA_PROTOCOL.DATA_CHUNK_SIZE)
      paddedChunk.set(chunk)
      paddedChunk.fill(0xFF, chunk.length)
      chunk = paddedChunk
    }
    
    // 构建OTA数据包（adr_index + 16字节数据 + CRC16）
    const otaPacket = this.buildOTAPacket(packetIndex, chunk)
    
    // 发送数据包（使用Write Without Response）
    await this.sendOTACommand(this.deviceId, this.serviceId, this.characteristicId, otaPacket)
    
    this.sentPackets++
  }

  /**
   * 构建OTA数据包（文档第7页示例代码）
   */
  buildOTAPacket(adrIndex, firmwareChunk) {
    // 数据包结构：2B adr_index + 16B数据 + 2B CRC = 20B
    const buffer = new ArrayBuffer(OTA_PROTOCOL.OTA_PACKET_SIZE)
    const view = new DataView(buffer)

    // 写入adr_index（小端序 - 文档第7页示例）
    view.setUint16(0, adrIndex, true)

    // 写入16字节固件数据
    for (let i = 0; i < OTA_PROTOCOL.DATA_CHUNK_SIZE; i++) {
      view.setUint8(2 + i, firmwareChunk[i])
    }

    // 计算CRC16（前18字节：adr_index + 数据）
    const crc = this.calculateCRC16(buffer.slice(0, 18))
    view.setUint16(18, crc, true) // CRC小端序写入

    return buffer
  }

  /**
   * CRC16计算（文档第8页代码）
   */
  calculateCRC16(data) {
    let crc = 0x0000
    const buffer = new Uint8Array(data)

    for (let i = 0; i < buffer.length; i++) {
      crc ^= buffer[i] << 8
      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) {
          crc = (crc << 1) ^ 0x1021
        } else {
          crc = crc << 1
        }
        crc &= 0xFFFF // 确保结果为16位
      }
    }
    return crc
  }

  /**
   * 发送结束命令（文档第7页：CMD_OTA_END）
   */
  async sendEndCommand() {
    // 计算最大adr_index和异或校验值
    const maxAdrIndex = this.totalPackets - 1
    const xorValue = maxAdrIndex ^ 0xFFFF
    
    // 构建结束命令：Opcode + max_adr_index + xor_value
    const endBuffer = new ArrayBuffer(6) // 2B Opcode + 2B max_adr_index + 2B xor_value
    const view = new DataView(endBuffer)
    
    view.setUint16(0, OTA_PROTOCOL.CMD_OTA_END, true)    // Opcode
    view.setUint16(2, maxAdrIndex, true)                 // 最大adr_index
    view.setUint16(4, xorValue, true)                    // 异或校验值
    
    await this.sendOTACommand(this.deviceId, this.serviceId, this.characteristicId, endBuffer)
    console.log('OTA结束命令发送成功')
  }

  /**
   * 验证升级结果（文档第7页：验证版本号是否匹配）
   */
  async verifyUpgrade() {
    console.log('等待设备重启...')
    
    // 等待设备重启（通常需要几秒钟）
    await this.delay(5000)
    
    // 重新连接设备
    // 这里需要实现重新扫描和连接逻辑
    await this.reconnectDevice()
    
    // 重新检查版本号
    const newVersion = await this.checkFirmwareVersion(
      this.deviceId, 
      this.serviceId, 
      this.characteristicId
    )
    
    // 与预期版本比较（这里需要从服务器获取预期版本）
    const expectedVersion = await this.getExpectedVersion()
    
    if (newVersion === expectedVersion) {
      console.log('OTA升级成功！')
      return true
    } else {
      throw new Error(`版本不匹配: 当前${newVersion}, 预期${expectedVersion}`)
    }
  }

  /**
   * 构建OTA命令（通用命令构建）
   */
  buildOTACommand(opcode, data) {
    const buffer = new ArrayBuffer(2 + (data ? data.byteLength : 0))
    const view = new DataView(buffer)
    
    view.setUint16(0, opcode, true) // Opcode小端序
    
    if (data) {
      const dataView = new Uint8Array(data)
      for (let i = 0; i < dataView.length; i++) {
        view.setUint8(2 + i, dataView[i])
      }
    }
    
    return buffer
  }

  /**
   * 发送OTA命令（使用Write Without Response）
   */
  async sendOTACommand(deviceId, serviceId, characteristicId, data) {
    return new Promise((resolve, reject) => {
      uni.writeBLECharacteristicValue({
        deviceId: deviceId,
        serviceId: serviceId,
        characteristicId: characteristicId,
        value: data,
        writeType: 'writeWithoutResponse', // 关键参数，不等待响应
        success: resolve,
        fail: (err) => {
          console.error('OTA命令发送失败:', err)
          reject(err)
        }
      })
    })
  }

  /**
   * 更新进度条（文档第7页进度计算公式）
   */
  updateProgress(currentPacketIndex) {
    // 进度 = (当前adr_index * 16) / 固件总大小 * 100%
    const progress = Math.round((currentPacketIndex * OTA_PROTOCOL.DATA_CHUNK_SIZE) / this.firmwareData.length * 100)
    this.currentProgress = Math.min(progress, 100)
    
    // 触发进度更新事件（实际项目中应该用回调或Vuex）
    if (this.onProgressUpdate) {
      this.onProgressUpdate(this.currentProgress)
    }
    
    console.log(`OTA升级进度: ${this.currentProgress}%`)
  }

  // 工具函数
  discoverServices(deviceId) {
    return new Promise((resolve, reject) => {
      uni.getBLEDeviceServices({
        deviceId: deviceId,
        success: (res) => resolve(res.services),
        fail: reject
      })
    })
  }

  discoverCharacteristics(deviceId, serviceId) {
    return new Promise((resolve, reject) => {
      uni.getBLEDeviceCharacteristics({
        deviceId: deviceId,
        serviceId: serviceId,
        success: (res) => resolve(res.characteristics),
        fail: reject
      })
    })
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // 这些方法需要根据实际项目实现
  async waitForVersionResponse() {
    // 实际实现中需要监听特征值通知来获取版本信息
    // 这里返回模拟数据
    return 'CC1_V1.1'
  }

  async reconnectDevice() {
    // 重新连接设备的逻辑
    console.log('重新连接设备...')
  }

  async getExpectedVersion() {
    // 从服务器获取预期版本号
    return 'CC1_V1.1'
  }

  // 设置进度回调
  setProgressCallback(callback) {
    this.onProgressUpdate = callback
  }

  // 获取当前状态
  getUpgradeStatus() {
    return {
      isUpgrading: this.isUpgrading,
      progress: this.currentProgress,
      totalPackets: this.totalPackets,
      sentPackets: this.sentPackets
    }
  }
}

// 创建单例实例
export const otaManager = new OTAUpgradeManager()