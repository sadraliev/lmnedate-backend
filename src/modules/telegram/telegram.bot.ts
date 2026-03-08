import { Bot, InlineKeyboard } from 'grammy';
import { logger } from '../../shared/config/logger.js';
import { instagramUsernameSchema } from './telegram.schemas.js';
import {
  findOrCreateUser,
  addSubscription,
  removeSubscription,
  getSubscriptions,
} from './telegram.service.js';
import type { InstagramPost } from './telegram.types.js';

let bot: Bot | null = null;

/**
 * Create and configure the Telegram bot
 */
export const createBot = (token: string): Bot => {
  bot = new Bot(token);

  bot.command('start', async (ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.from?.username;
    const firstName = ctx.from?.first_name;

    await findOrCreateUser(chatId, username, firstName);

    await ctx.reply(
      'Welcome to Instagram Post Bot!\n\n' +
      'I can deliver the latest posts from public Instagram accounts right here in Telegram.\n\n' +
      'Commands:\n' +
      '/follow <username> - Follow an Instagram account\n' +
      '/unfollow <username> - Unfollow an account\n' +
      '/list - View your subscriptions\n' +
      '/help - Show this message'
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      'Instagram Post Bot - Commands:\n\n' +
      '/follow <username> - Follow a public Instagram account\n' +
      '  Example: /follow bbcnews\n\n' +
      '/unfollow <username> - Stop following an account\n' +
      '  Example: /unfollow bbcnews\n\n' +
      '/list - View all your active subscriptions\n\n' +
      'Posts are checked every 15 minutes and delivered automatically.'
    );
  });

  bot.command('follow', async (ctx) => {
    const chatId = ctx.chat.id;
    const username = ctx.from?.username;
    const firstName = ctx.from?.first_name;

    await findOrCreateUser(chatId, username, firstName);

    const rawUsername = ctx.match?.trim();
    if (!rawUsername) {
      await ctx.reply('Please provide an Instagram username.\nExample: /follow bbcnews');
      return;
    }

    const parsed = instagramUsernameSchema.safeParse(rawUsername);
    if (!parsed.success) {
      await ctx.reply('Invalid username. Use only letters, numbers, periods, and underscores.');
      return;
    }

    const instagramUsername = parsed.data;
    const result = await addSubscription(chatId, instagramUsername);

    if (result.error) {
      await ctx.reply(result.error);
      return;
    }

    await ctx.reply(`Now following @${instagramUsername}! New posts will be delivered here.`);
  });

  bot.command('unfollow', async (ctx) => {
    const chatId = ctx.chat.id;
    const rawUsername = ctx.match?.trim();

    if (!rawUsername) {
      await ctx.reply('Please provide an Instagram username.\nExample: /unfollow bbcnews');
      return;
    }

    const parsed = instagramUsernameSchema.safeParse(rawUsername);
    if (!parsed.success) {
      await ctx.reply('Invalid username format.');
      return;
    }

    const instagramUsername = parsed.data;
    const removed = await removeSubscription(chatId, instagramUsername);

    if (removed) {
      await ctx.reply(`Unfollowed @${instagramUsername}.`);
    } else {
      await ctx.reply(`You are not following @${instagramUsername}.`);
    }
  });

  bot.command('list', async (ctx) => {
    const chatId = ctx.chat.id;
    const subs = await getSubscriptions(chatId);

    if (subs.length === 0) {
      await ctx.reply('You have no active subscriptions.\nUse /follow <username> to get started.');
      return;
    }

    const keyboard = new InlineKeyboard();
    const lines = subs.map((sub, i) => {
      keyboard.text(`Unfollow @${sub.instagramUsername}`, `unfollow:${sub.instagramUsername}`);
      if (i < subs.length - 1) keyboard.row();
      return `- @${sub.instagramUsername}`;
    });

    await ctx.reply(
      `Your subscriptions (${subs.length}):\n\n${lines.join('\n')}`,
      { reply_markup: keyboard }
    );
  });

  // Handle inline keyboard callbacks
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data.startsWith('unfollow:')) {
      const instagramUsername = data.replace('unfollow:', '');
      const chatId = ctx.chat?.id;

      if (!chatId) {
        await ctx.answerCallbackQuery({ text: 'Error: could not determine chat.' });
        return;
      }

      const removed = await removeSubscription(chatId, instagramUsername);

      if (removed) {
        await ctx.answerCallbackQuery({ text: `Unfollowed @${instagramUsername}` });
        // Re-render the list
        const subs = await getSubscriptions(chatId);
        if (subs.length === 0) {
          await ctx.editMessageText('You have no active subscriptions.\nUse /follow <username> to get started.');
        } else {
          const keyboard = new InlineKeyboard();
          const lines = subs.map((sub, i) => {
            keyboard.text(`Unfollow @${sub.instagramUsername}`, `unfollow:${sub.instagramUsername}`);
            if (i < subs.length - 1) keyboard.row();
            return `- @${sub.instagramUsername}`;
          });
          await ctx.editMessageText(
            `Your subscriptions (${subs.length}):\n\n${lines.join('\n')}`,
            { reply_markup: keyboard }
          );
        }
      } else {
        await ctx.answerCallbackQuery({ text: 'Already unfollowed.' });
      }
    }
  });

  bot.catch((err) => {
    logger.error({ error: err.error, ctx: err.ctx?.update }, 'Telegram bot error');
  });

  return bot;
};

/**
 * Deliver a post to a Telegram chat
 */
export const deliverPostToChat = async (
  botInstance: Bot,
  chatId: number,
  post: InstagramPost
): Promise<void> => {
  const caption =
    `<b>@${post.instagramUsername}</b>\n\n` +
    (post.caption ? `${post.caption.substring(0, 800)}\n\n` : '') +
    `<a href="${post.permalink}">View on Instagram</a>`;

  try {
    if (post.mediaType === 'video') {
      await botInstance.api.sendMessage(chatId, caption, {
        parse_mode: 'HTML',
        link_preview_options: { url: post.permalink, prefer_large_media: true },
      });
    } else {
      await botInstance.api.sendPhoto(chatId, post.mediaUrl, {
        caption,
        parse_mode: 'HTML',
      });
    }
  } catch (error) {
    logger.error({ chatId, postId: post.postId, error }, 'Failed to deliver post to chat');
    throw error;
  }
};

/**
 * Get the bot instance
 */
export const getBot = (): Bot | null => bot;
