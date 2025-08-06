/**
 * Slack Notification Channel
 * Sends notifications via Slack Bot
 */

const NotificationChannel = require('../base/channel');
const { WebClient } = require('@slack/web-api');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const CommandRelay = require('../../relay/command-relay');

class SlackChannel extends NotificationChannel {
    constructor(config = {}) {
        super('slack', config);
        this.sessionsDir = path.join(__dirname, '../../data/sessions');
        this.client = new WebClient(this.config.botToken);
        this._ensureDirectories();
    }

    _ensureDirectories() {
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
    }

    _validateConfig() {
        if (!this.config.botToken) {
            this.logger.warn('Slack Bot Token not found');
            return false;
        }
        if (!this.config.channelId) {
            this.logger.warn('Slack Channel ID not found');
            return false;
        }
        return true;
    }

    async _sendImpl(notification) {
        if (!this.validateConfig()) {
            throw new Error('Slack channel not properly configured');
        }

        const token = this._generateToken();
        const sessionId = this._createSession(notification, token);

        const messageText = this._generateSlackMessage(notification, token);

        try {
            await this.client.chat.postMessage({
                channel: this.config.channelId,
                text: messageText,
            });
            this.logger.info(`Slack message sent successfully, Session: ${sessionId}`);
            return true;
        } catch (error) {
            this.logger.error('Failed to send Slack message:', error.message);
            this._removeSession(sessionId);
            return false;
        }
    }

    _generateToken() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let token = '';
        for (let i = 0; i < 8; i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
    }

    _getCurrentTmuxSession() {
        try {
            const { execSync } = require('child_process');
            const tmuxSession = execSync('tmux display-message -p "#S"', {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();

            return tmuxSession || null;
        } catch (error) {
            return null;
        }
    }

    _createSession(notification, token) {
        const sessionId = uuidv4();
        const tmuxSession = this._getCurrentTmuxSession();

        if (tmuxSession && !notification.metadata) {
             const TmuxMonitor = require('../../utils/tmux-monitor');
             const tmuxMonitor = new TmuxMonitor();
             const conversation = tmuxMonitor.getRecentConversation(tmuxSession);
             notification.metadata = {
                 userQuestion: conversation.userQuestion || notification.message,
                 claudeResponse: conversation.claudeResponse || notification.message,
                 tmuxSession: tmuxSession
             };
        }

        const session = {
            id: sessionId,
            token: token,
            type: 'slack',
            created: new Date().toISOString(),
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            tmuxSession: notification.metadata?.tmuxSession || 'default',
            project: notification.project,
            notification: notification
        };

        const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
        fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
        this.logger.debug(`Session created: ${sessionId}`);
        return sessionId;
    }

    _removeSession(sessionId) {
        const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
        if (fs.existsSync(sessionFile)) {
            fs.unlinkSync(sessionFile);
            this.logger.debug(`Session removed: ${sessionId}`);
        }
    }

    _generateSlackMessage(notification, token) {
        const type = notification.type;
        const emoji = type === 'completed' ? '✅' : '⏳';
        const status = type === 'completed' ? 'Completed' : 'Waiting for Input';

        let messageText = `${emoji} *Claude Task ${status}*\n\n`;
        messageText += `*Project:*\n${notification.project}\n\n`;
        messageText += `*Session Token:*\n\`${token}\`\n\n`;

        if (notification.metadata && notification.metadata.userQuestion) {
            messageText += `*Your Question:*\n> ${notification.metadata.userQuestion.substring(0, 500)}\n\n`;
        }
        if (notification.metadata && notification.metadata.claudeResponse) {
            messageText += `*Claude Response:*\n> ${notification.metadata.claudeResponse.substring(0, 1000)}\n\n`;
        }

        messageText += `To send a new command, use: \`/claude ${token} <your command>\``;

        return messageText;
    }

    supportsRelay() {
        return true;
    }

    async handleCommand(command, context) {
        this.logger.info(`Handling command from Slack: "${command}" with token ${context.token}`);
        const commandRelay = new CommandRelay();
        const result = await commandRelay.relayCommand(context.token, command);
        return result;
    }

    validateConfig() {
        return this._validateConfig();
    }
}

module.exports = SlackChannel;
