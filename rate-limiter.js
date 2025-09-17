class RateLimiter {
    constructor(delayMs = 5000) {
        this.delayMs = delayMs;
        this.baseDelayMs = delayMs;
        this.lastMessageTime = 0;
        this.messageQueue = [];
        this.isProcessingQueue = false;
        
        // Adaptive rate limiting based on performance
        this.performanceHistory = [];
        this.errorHistory = [];
        this.speedHistory = [];
        this.adaptiveMode = true;
        this.minDelay = 100;  // Minimum delay in ms
        this.maxDelay = 10000; // Maximum delay in ms
        this.optimizationTarget = 30; // Target speed in Mbps
    }

    // Wait if needed to respect rate limit
    async waitIfNeeded() {
        const now = Date.now();
        const timeSinceLastMessage = now - this.lastMessageTime;
        
        if (timeSinceLastMessage < this.delayMs) {
            const waitTime = this.delayMs - timeSinceLastMessage;
            console.log(`⏳ Rate limiting: waiting ${waitTime}ms before next message`);
            await this.sleep(waitTime);
        }
        
        this.lastMessageTime = Date.now();
    }

    // Add message to queue (alternative approach)
    addToQueue(messageFunction) {
        return new Promise((resolve, reject) => {
            this.messageQueue.push({
                messageFunction,
                resolve,
                reject,
                timestamp: Date.now()
            });
            
            this.processQueue();
        });
    }

    // Process message queue with rate limiting
    async processQueue() {
        if (this.isProcessingQueue || this.messageQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        try {
            while (this.messageQueue.length > 0) {
                const { messageFunction, resolve, reject } = this.messageQueue.shift();
                
                try {
                    // Apply rate limiting
                    await this.waitIfNeeded();
                    
                    // Execute the message function
                    const result = await messageFunction();
                    resolve(result);
                    
                } catch (error) {
                    reject(error);
                }
            }
        } finally {
            this.isProcessingQueue = false;
        }
    }

    // Get current queue status
    getQueueStatus() {
        return {
            queueLength: this.messageQueue.length,
            isProcessing: this.isProcessingQueue,
            lastMessageTime: this.lastMessageTime,
            delayMs: this.delayMs
        };
    }

    // Update rate limit delay
    setDelay(newDelayMs) {
        this.delayMs = newDelayMs;
        console.log(`📝 Rate limit delay updated to ${newDelayMs}ms`);
    }

    // Clear the queue (emergency use)
    clearQueue() {
        const clearedCount = this.messageQueue.length;
        
        // Reject all pending messages
        this.messageQueue.forEach(({ reject }) => {
            reject(new Error('Queue cleared'));
        });
        
        this.messageQueue = [];
        console.log(`🗑️ Cleared ${clearedCount} messages from rate limit queue`);
        
        return clearedCount;
    }

    // Sleep utility
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Get statistics
    getStats() {
        const now = Date.now();
        const timeSinceLastMessage = now - this.lastMessageTime;
        
        return {
            delayMs: this.delayMs,
            queueLength: this.messageQueue.length,
            isProcessing: this.isProcessingQueue,
            lastMessageTime: this.lastMessageTime,
            timeSinceLastMessage,
            canSendImmediately: timeSinceLastMessage >= this.delayMs
        };
    }

    // Record network performance for adaptive optimization
    recordPerformance(speedMbps, hasErrors = false, fileSize = 0) {
        const now = Date.now();
        
        // Record speed performance
        this.speedHistory.push({
            timestamp: now,
            speedMbps: parseFloat(speedMbps) || 0,
            fileSize: fileSize
        });
        
        // Record errors
        if (hasErrors) {
            this.errorHistory.push({
                timestamp: now,
                type: 'general'
            });
        }
        
        // Keep only recent history (last 5 minutes)
        const fiveMinutesAgo = now - (5 * 60 * 1000);
        this.speedHistory = this.speedHistory.filter(entry => entry.timestamp > fiveMinutesAgo);
        this.errorHistory = this.errorHistory.filter(entry => entry.timestamp > fiveMinutesAgo);
        
        // Update adaptive delay if in adaptive mode
        if (this.adaptiveMode) {
            this.updateAdaptiveDelay();
        }
    }
    
    // Record specific error types for better adaptation
    recordError(errorType, waitTime = null) {
        this.errorHistory.push({
            timestamp: Date.now(),
            type: errorType,
            waitTime: waitTime
        });
        
        // Immediate adaptation for critical errors
        if (errorType === 'FLOOD_WAIT' && waitTime) {
            // Increase delay significantly after flood wait
            const newDelay = Math.min(this.delayMs * 2, this.maxDelay);
            this.setDelay(newDelay);
            console.log(`🚨 Flood wait detected! Increased delay to ${newDelay}ms`);
        } else if (errorType === 'FILE_REFERENCE_EXPIRED') {
            // Slightly increase delay for file reference errors
            const newDelay = Math.min(this.delayMs * 1.3, this.maxDelay);
            this.setDelay(newDelay);
            console.log(`⚠️ File reference error! Adjusted delay to ${newDelay}ms`);
        }
    }
    
    // Intelligent adaptive delay calculation based on performance metrics
    updateAdaptiveDelay() {
        if (this.speedHistory.length < 3) return; // Need some data first
        
        // Calculate recent average speed
        const recentSpeeds = this.speedHistory.slice(-5).map(entry => entry.speedMbps);
        const avgSpeed = recentSpeeds.reduce((sum, speed) => sum + speed, 0) / recentSpeeds.length;
        
        // Calculate error rate in last minute
        const oneMinuteAgo = Date.now() - 60000;
        const recentErrors = this.errorHistory.filter(entry => entry.timestamp > oneMinuteAgo);
        const errorRate = recentErrors.length / Math.max(1, this.speedHistory.length);
        
        let newDelay = this.delayMs;
        
        // Speed-based adjustment
        if (avgSpeed > this.optimizationTarget * 1.2) {
            // Very good speed - can reduce delays
            newDelay = Math.max(this.minDelay, this.delayMs * 0.8);
        } else if (avgSpeed > this.optimizationTarget) {
            // Good speed - slightly reduce delays
            newDelay = Math.max(this.minDelay, this.delayMs * 0.9);
        } else if (avgSpeed < this.optimizationTarget * 0.5) {
            // Poor speed - increase delays
            newDelay = Math.min(this.maxDelay, this.delayMs * 1.3);
        } else if (avgSpeed < this.optimizationTarget * 0.8) {
            // Below target - moderately increase delays
            newDelay = Math.min(this.maxDelay, this.delayMs * 1.1);
        }
        
        // Error-based adjustment
        if (errorRate > 0.2) {
            // High error rate - increase delays significantly
            newDelay = Math.min(this.maxDelay, newDelay * 1.5);
        } else if (errorRate > 0.1) {
            // Moderate error rate - increase delays moderately
            newDelay = Math.min(this.maxDelay, newDelay * 1.2);
        }
        
        // Apply the new delay if it changed significantly
        if (Math.abs(newDelay - this.delayMs) > 100) {
            this.setDelay(Math.round(newDelay));
            console.log(`🔧 Adaptive delay: ${avgSpeed.toFixed(1)} Mbps avg speed, ${(errorRate * 100).toFixed(1)}% errors -> ${this.delayMs}ms delay`);
        }
    }
    
    // Enhanced adaptive delay that also considers file size patterns
    adaptiveDelayV2(messageCount, avgFileSize = 0, timeWindow = 60000) {
        const messagesPerMinute = messageCount / (timeWindow / 60000);
        let baseDelay = this.baseDelayMs;
        
        // File size based adjustment
        const fileSizeMB = avgFileSize / (1024 * 1024);
        if (fileSizeMB < 10) {
            // Small files can handle faster processing
            baseDelay *= 0.6;
        } else if (fileSizeMB < 100) {
            // Medium files
            baseDelay *= 0.8;
        } else {
            // Large files need more conservative delays
            baseDelay *= 1.2;
        }
        
        // Frequency based adjustment
        if (messagesPerMinute > 15) {
            baseDelay *= 1.4; // Much higher frequency
        } else if (messagesPerMinute > 10) {
            baseDelay *= 1.2; // High frequency
        } else if (messagesPerMinute < 3) {
            baseDelay *= 0.7; // Low frequency
        }
        
        // Apply bounds and set delay
        const newDelay = Math.max(this.minDelay, Math.min(this.maxDelay, baseDelay));
        this.setDelay(Math.round(newDelay));
        
        console.log(`📊 Adaptive delay v2: ${messagesPerMinute.toFixed(1)} msg/min, ${fileSizeMB.toFixed(1)}MB avg -> ${this.delayMs}ms`);
    }

    // Calculate optimal delay based on message frequency (enhanced version)
    adaptiveDelay(messageCount, timeWindow = 60000) {
        // Use the new enhanced version
        this.adaptiveDelayV2(messageCount, 0, timeWindow);
    }
    
    // Get comprehensive statistics including performance data
    getEnhancedStats() {
        const basicStats = this.getStats();
        
        // Calculate performance metrics
        const recentSpeeds = this.speedHistory.slice(-5);
        const avgSpeed = recentSpeeds.length > 0 
            ? recentSpeeds.reduce((sum, entry) => sum + entry.speedMbps, 0) / recentSpeeds.length 
            : 0;
            
        const recentErrors = this.errorHistory.filter(entry => 
            entry.timestamp > (Date.now() - 60000)
        );
        
        return {
            ...basicStats,
            adaptiveMode: this.adaptiveMode,
            avgRecentSpeed: avgSpeed.toFixed(1),
            recentErrors: recentErrors.length,
            performanceHistory: this.speedHistory.length,
            minDelay: this.minDelay,
            maxDelay: this.maxDelay,
            targetSpeed: this.optimizationTarget
        };
    }
}

module.exports = RateLimiter;
