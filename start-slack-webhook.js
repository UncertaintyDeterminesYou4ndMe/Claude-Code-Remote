#!/usr/bin/env node

/**
 * Slack Webhook Server
 * Starts a Bolt server to listen for commands from Slack
 */

const { App } = require('@slack/bolt');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const SlackChannel = require('./src/channels/slack/slack');

// Load environment variables
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

const slackConfig = {
    botToken: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    channelId: process.env.SLACK_CHANNEL_ID,
    appToken: process.env.SLACK_APP_TOKEN // Required for Socket Mode
};

if (!slackConfig.botToken || !slackConfig.signingSecret || !slackConfig.appToken) {
    console.error('❌ Missing Slack environment variables. Please check your .env file.');
    console.error('   Required: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN');
    process.exit(1);
}

// Initialize Bolt app
const app = new App({
    token: slackConfig.botToken,
    signingSecret: slackConfig.signingSecret,
    socketMode: true, // Using Socket Mode for easier local development
    appToken: slackConfig.appToken
});

const slackChannel = new SlackChannel(slackConfig);

// Listen for the /claude command
app.command('/claude', async ({ command, ack, say }) => {
    await ack();

    const text = command.text.trim();
    const tokenMatch = text.match(/^([A-Z0-9]{8})\s/);

    if (!tokenMatch) {
        await say('Invalid command format. Please use: `/claude <TOKEN> <your command>`');
        return;
    }

    const token = tokenMatch[1];
    const commandText = text.substring(token.length + 1);

    if (!commandText) {
        await say('Invalid command format. Please include a command after the token.');
        return;
    }

    try {
        const result = await slackChannel.handleCommand(commandText, { token });
        if (result.success) {
            await say(`✅ Command sent to session \`${result.session.tmuxSession}\`: \`${commandText}\``);
        } else {
            await say(`❌ Failed to send command: ${result.message}`);
        }
    } catch (error) {
        console.error('Error handling command:', error);
        await say('An unexpected error occurred. Please check the logs.');
    }
});

(async () => {
    // Start the app
    await app.start();
    console.log('⚡️ Bolt app is running!');
})();
