const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class SpeedMonitor {
    constructor() {
        this.isMonitoring = false;
        this.networkInterfaces = [];
        this.previousStats = null;
        this.currentStats = null;
        this.monitoringInterval = null;
        this.monitoringStartTime = null;
        
        // Enhanced performance tracking
        this.speedHistory = [];
        this.performanceMetrics = {
            peakDownload: 0,
            peakUpload: 0,
            avgDownload: 0,
            avgUpload: 0,
            totalDataTransferred: 0,
            transferCount: 0,
            consistencyScore: 0
        };
        
        // Real-time optimization tracking
        this.optimizationData = {
            slowTransfers: [],
            fastTransfers: [],
            fileTypePerformance: new Map(),
            timeOfDayPerformance: new Map()
        };
        
        this.initializeNetworkInterfaces();
    }

    initializeNetworkInterfaces() {
        try {
            // Get available network interfaces synchronously
            const { execSync } = require('child_process');
            
            // Get network interface names (excluding loopback)
            const stdout = execSync("ls /sys/class/net/ | grep -v lo", { encoding: 'utf8', timeout: 5000 });
            this.networkInterfaces = stdout.trim().split('\n').filter(iface => iface.trim());
            
            console.log('Available network interfaces:', this.networkInterfaces);
        } catch (error) {
            console.warn('Could not detect network interfaces, using default:', error.message);
            this.networkInterfaces = ['eth0', 'wlan0', 'ens33'];
        }
    }

    startMonitoring() {
        if (this.isMonitoring) {
            return;
        }

        this.isMonitoring = true;
        this.monitoringStartTime = Date.now();
        
        // Get initial network stats
        this.updateNetworkStats();
        
        // Update stats every 5 seconds for accurate speed calculation
        this.monitoringInterval = setInterval(() => {
            this.updateNetworkStats();
        }, 5000);
        
        console.log('📡 Speed monitoring started');
    }

    stopMonitoring() {
        if (!this.isMonitoring) {
            return;
        }

        this.isMonitoring = false;
        
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        
        this.previousStats = null;
        this.currentStats = null;
        
        console.log('📡 Speed monitoring stopped');
    }

    async updateNetworkStats() {
        try {
            const newStats = await this.getNetworkStats();
            
            if (newStats) {
                this.previousStats = this.currentStats;
                this.currentStats = newStats;
            }
        } catch (error) {
            console.warn('Failed to update network stats:', error.message);
        }
    }

    async getNetworkStats() {
        try {
            const stats = {
                timestamp: Date.now(),
                interfaces: {}
            };

            // Read network statistics from /proc/net/dev
            const netDevData = await this.readFile('/proc/net/dev');
            const lines = netDevData.split('\n');
            
            for (let i = 2; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                const parts = line.split(/\s+/);
                if (parts.length < 17) continue;
                
                const interfaceName = parts[0].replace(':', '');
                
                // Skip loopback and inactive interfaces
                if (interfaceName === 'lo' || !this.networkInterfaces.includes(interfaceName)) {
                    continue;
                }
                
                stats.interfaces[interfaceName] = {
                    rxBytes: parseInt(parts[1]) || 0,
                    txBytes: parseInt(parts[9]) || 0,
                    rxPackets: parseInt(parts[2]) || 0,
                    txPackets: parseInt(parts[10]) || 0
                };
            }
            
            return stats;
        } catch (error) {
            // Fallback to alternative method if /proc/net/dev is not available
            return await this.getNetworkStatsAlternative();
        }
    }

    async getNetworkStatsAlternative() {
        try {
            const { promisify } = require('util');
            const execAsync = promisify(exec);
            
            const stats = {
                timestamp: Date.now(),
                interfaces: {}
            };
            
            // Use ip command to get network statistics
            for (const iface of this.networkInterfaces) {
                try {
                    const { stdout } = await execAsync(`ip -s link show ${iface}`);
                    const lines = stdout.split('\n');
                    
                    // Parse RX stats
                    const rxLine = lines.find(line => line.includes('RX:'));
                    const txLine = lines.find(line => line.includes('TX:'));
                    
                    if (rxLine && txLine) {
                        const rxMatch = rxLine.match(/(\d+)\s+(\d+)/);
                        const txMatch = txLine.match(/(\d+)\s+(\d+)/);
                        
                        if (rxMatch && txMatch) {
                            stats.interfaces[iface] = {
                                rxBytes: parseInt(rxMatch[1]) || 0,
                                txBytes: parseInt(txMatch[1]) || 0,
                                rxPackets: parseInt(rxMatch[2]) || 0,
                                txPackets: parseInt(txMatch[2]) || 0
                            };
                        }
                    }
                } catch (ifaceError) {
                    // Interface might not exist, continue with others
                    continue;
                }
            }
            
            return stats;
        } catch (error) {
            console.warn('Alternative network stats method failed:', error.message);
            return null;
        }
    }

    async readFile(filePath) {
        return new Promise((resolve, reject) => {
            fs.readFile(filePath, 'utf8', (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
    }

    async getCurrentSpeed() {
        if (!this.isMonitoring || !this.previousStats || !this.currentStats) {
            return {
                download: '0.0',
                upload: '0.0',
                total: '0.0',
                duration: 0
            };
        }

        try {
            const timeDiff = (this.currentStats.timestamp - this.previousStats.timestamp) / 1000; // seconds
            
            if (timeDiff <= 0) {
                return {
                    download: '0.0',
                    upload: '0.0',
                    total: '0.0',
                    duration: 0
                };
            }

            let totalRxBytes = 0;
            let totalTxBytes = 0;

            // Sum up all active interfaces
            for (const interfaceName of this.networkInterfaces) {
                const currentIface = this.currentStats.interfaces[interfaceName];
                const previousIface = this.previousStats.interfaces[interfaceName];
                
                if (currentIface && previousIface) {
                    const rxDiff = currentIface.rxBytes - previousIface.rxBytes;
                    const txDiff = currentIface.txBytes - previousIface.txBytes;
                    
                    // Only count positive differences (avoid counter resets)
                    if (rxDiff >= 0) totalRxBytes += rxDiff;
                    if (txDiff >= 0) totalTxBytes += txDiff;
                }
            }

            // Calculate speeds in MB/s
            const downloadSpeed = (totalRxBytes / timeDiff) / (1024 * 1024); // MB/s
            const uploadSpeed = (totalTxBytes / timeDiff) / (1024 * 1024); // MB/s
            const totalSpeed = downloadSpeed + uploadSpeed;

            return {
                download: downloadSpeed.toFixed(1),
                upload: uploadSpeed.toFixed(1),
                total: totalSpeed.toFixed(1),
                duration: Math.floor((Date.now() - this.monitoringStartTime) / 1000)
            };
        } catch (error) {
            console.warn('Failed to calculate current speed:', error.message);
            return {
                download: '0.0',
                upload: '0.0', 
                total: '0.0',
                duration: 0
            };
        }
    }

    // Record file transfer performance for optimization analysis
    recordTransfer(speedMbps, fileSize, fileType = 'unknown', success = true) {
        const now = Date.now();
        const transferData = {
            timestamp: now,
            speedMbps: parseFloat(speedMbps) || 0,
            fileSize: fileSize || 0,
            fileType: fileType.toLowerCase(),
            success: success,
            hourOfDay: new Date(now).getHours()
        };
        
        // Update speed history
        this.speedHistory.push(transferData);
        
        // Keep only last 100 transfers for performance
        if (this.speedHistory.length > 100) {
            this.speedHistory = this.speedHistory.slice(-100);
        }
        
        // Update performance metrics
        this.updatePerformanceMetrics(transferData);
        
        // Categorize transfer performance
        if (speedMbps > 25) {
            this.optimizationData.fastTransfers.push(transferData);
            if (this.optimizationData.fastTransfers.length > 20) {
                this.optimizationData.fastTransfers = this.optimizationData.fastTransfers.slice(-20);
            }
        } else if (speedMbps < 10) {
            this.optimizationData.slowTransfers.push(transferData);
            if (this.optimizationData.slowTransfers.length > 20) {
                this.optimizationData.slowTransfers = this.optimizationData.slowTransfers.slice(-20);
            }
        }
        
        // Track file type performance
        const typeStats = this.optimizationData.fileTypePerformance.get(fileType) || {
            transfers: [],
            avgSpeed: 0,
            count: 0
        };
        typeStats.transfers.push(transferData);
        if (typeStats.transfers.length > 10) {
            typeStats.transfers = typeStats.transfers.slice(-10);
        }
        typeStats.avgSpeed = typeStats.transfers.reduce((sum, t) => sum + t.speedMbps, 0) / typeStats.transfers.length;
        typeStats.count = typeStats.transfers.length;
        this.optimizationData.fileTypePerformance.set(fileType, typeStats);
        
        // Track time of day performance
        const hourStats = this.optimizationData.timeOfDayPerformance.get(transferData.hourOfDay) || {
            transfers: [],
            avgSpeed: 0,
            count: 0
        };
        hourStats.transfers.push(transferData);
        if (hourStats.transfers.length > 5) {
            hourStats.transfers = hourStats.transfers.slice(-5);
        }
        hourStats.avgSpeed = hourStats.transfers.reduce((sum, t) => sum + t.speedMbps, 0) / hourStats.transfers.length;
        hourStats.count = hourStats.transfers.length;
        this.optimizationData.timeOfDayPerformance.set(transferData.hourOfDay, hourStats);
    }
    
    updatePerformanceMetrics(transferData) {
        const { speedMbps, fileSize } = transferData;
        
        // Update peaks
        if (speedMbps > this.performanceMetrics.peakDownload) {
            this.performanceMetrics.peakDownload = speedMbps;
        }
        
        // Update totals
        this.performanceMetrics.totalDataTransferred += fileSize;
        this.performanceMetrics.transferCount++;
        
        // Calculate running averages from recent history
        if (this.speedHistory.length > 0) {
            const recentTransfers = this.speedHistory.slice(-10);
            this.performanceMetrics.avgDownload = recentTransfers.reduce((sum, t) => sum + t.speedMbps, 0) / recentTransfers.length;
            
            // Calculate consistency score (lower variance = higher consistency)
            const variance = recentTransfers.reduce((sum, t) => sum + Math.pow(t.speedMbps - this.performanceMetrics.avgDownload, 2), 0) / recentTransfers.length;
            this.performanceMetrics.consistencyScore = Math.max(0, 100 - (variance * 2)); // Convert to 0-100 scale
        }
    }
    
    // Get optimization recommendations based on performance data
    getOptimizationRecommendations() {
        const recommendations = [];
        
        // Analyze slow transfers
        if (this.optimizationData.slowTransfers.length > 5) {
            const commonIssues = this.analyzeSlowTransfers();
            recommendations.push(...commonIssues);
        }
        
        // Analyze file type performance
        const fileTypeIssues = this.analyzeFileTypePerformance();
        recommendations.push(...fileTypeIssues);
        
        // Analyze time-based patterns
        const timeBasedIssues = this.analyzeTimeBasedPerformance();
        recommendations.push(...timeBasedIssues);
        
        return recommendations;
    }
    
    analyzeSlowTransfers() {
        const recommendations = [];
        const slowTransfers = this.optimizationData.slowTransfers;
        
        // Check for consistent file type issues
        const fileTypeCounts = {};
        slowTransfers.forEach(t => {
            fileTypeCounts[t.fileType] = (fileTypeCounts[t.fileType] || 0) + 1;
        });
        
        for (const [fileType, count] of Object.entries(fileTypeCounts)) {
            if (count >= 3) {
                recommendations.push({
                    type: 'file_type_slow',
                    priority: 'medium',
                    message: `${fileType} files are consistently slow (${count} recent slow transfers)`,
                    suggestion: 'Consider different chunk sizes or compression for this file type'
                });
            }
        }
        
        // Check for size-related issues
        const largeSlow = slowTransfers.filter(t => t.fileSize > 100 * 1024 * 1024).length;
        if (largeSlow >= 3) {
            recommendations.push({
                type: 'large_file_slow',
                priority: 'high',
                message: `Large files (>100MB) are consistently slow (${largeSlow} recent cases)`,
                suggestion: 'Consider increasing chunk sizes for large files or using parallel processing'
            });
        }
        
        return recommendations;
    }
    
    analyzeFileTypePerformance() {
        const recommendations = [];
        
        for (const [fileType, stats] of this.optimizationData.fileTypePerformance.entries()) {
            if (stats.count >= 3 && stats.avgSpeed < 15) {
                recommendations.push({
                    type: 'file_type_optimization',
                    priority: 'medium',
                    message: `${fileType} files average ${stats.avgSpeed.toFixed(1)} Mbps (below target)`,
                    suggestion: `Optimize settings specifically for ${fileType} files`
                });
            }
        }
        
        return recommendations;
    }
    
    analyzeTimeBasedPerformance() {
        const recommendations = [];
        
        for (const [hour, stats] of this.optimizationData.timeOfDayPerformance.entries()) {
            if (stats.count >= 3 && stats.avgSpeed < 10) {
                recommendations.push({
                    type: 'time_based_slow',
                    priority: 'low',
                    message: `Performance is consistently slower around ${hour}:00 (${stats.avgSpeed.toFixed(1)} Mbps avg)`,
                    suggestion: 'Consider adjusting transfer schedules or increasing delays during peak hours'
                });
            }
        }
        
        return recommendations;
    }
    
    // Get performance trend analysis
    getPerformanceTrends() {
        if (this.speedHistory.length < 5) return null;
        
        const recent = this.speedHistory.slice(-10);
        const older = this.speedHistory.slice(-20, -10);
        
        if (older.length === 0) return null;
        
        const recentAvg = recent.reduce((sum, t) => sum + t.speedMbps, 0) / recent.length;
        const olderAvg = older.reduce((sum, t) => sum + t.speedMbps, 0) / older.length;
        
        const trend = ((recentAvg - olderAvg) / olderAvg) * 100;
        
        return {
            recentAvgSpeed: recentAvg.toFixed(1),
            olderAvgSpeed: olderAvg.toFixed(1),
            trendPercentage: trend.toFixed(1),
            trendDirection: trend > 5 ? 'improving' : trend < -5 ? 'declining' : 'stable'
        };
    }

    async getDetailedStats() {
        const speed = await this.getCurrentSpeed();
        const totalDuration = this.monitoringStartTime ? 
            Math.floor((Date.now() - this.monitoringStartTime) / 1000) : 0;
        
        return {
            speed,
            monitoring: {
                isActive: this.isMonitoring,
                duration: totalDuration,
                startTime: this.monitoringStartTime,
                interfaces: this.networkInterfaces.length
            },
            interfaces: this.currentStats ? Object.keys(this.currentStats.interfaces) : [],
            performance: this.performanceMetrics,
            trends: this.getPerformanceTrends(),
            recommendations: this.getOptimizationRecommendations(),
            transferHistory: this.speedHistory.length
        };
    }
}

module.exports = SpeedMonitor;
