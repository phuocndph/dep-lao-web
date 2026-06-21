/**
 * facebookIpc.ts
 * IPC handlers cho táº¥t cáº£ Facebook operations
 * Pattern: ipcMain.handle('fb:channel', async (_event, params) => { ... })
 */

import { ipcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import DatabaseService from '../../src/services/database/DatabaseService';
import FacebookConnectionManager from '../../src/utils/FacebookConnectionManager';
import { initSession, fetchBasicProfileFromHome, fetchFBHomepage, getUserInfoFacebookHtml } from '../../src/services/facebook/FacebookSession';
import { loginWithCredentials } from '../../src/services/facebook/FacebookLoginHelper';
import { secureGet, secureSet, secureDelete } from '../../src/services/secure/SecureSettingsService';
import FileStorageService from '../../src/services/file/FileStorageService';
import EventBroadcaster from '../../src/services/event/EventBroadcaster';
import Logger from '../../src/utils/Logger';
import FacebookService from "../../src/services/facebook/FacebookService";

// â”€â”€â”€ Cookie secure storage helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function fbCookieKey(accountId: string): string {
  return `fb_cookie_${accountId}`;
}

/**
 * Resolve accountId: náº¿u lÃ  Facebook UID (all digits) â†’ tÃ¬m UUID tá»« fb_accounts.
 * Náº¿u Ä‘Ã£ lÃ  UUID â†’ tráº£ vá» nguyÃªn. DÃ¹ng cho táº¥t cáº£ handlers nháº­n accountId tá»« UI.
 */
function resolveInternalId(accountId: string): string {
  // Náº¿u trÃ´ng giá»‘ng Facebook UID (all digits) â†’ lookup UUID
  if (/^\d+$/.test(accountId)) {
    const fbAcc = DatabaseService.getInstance().getFBAccountByFacebookId(accountId);
    if (fbAcc?.id) return fbAcc.id;
  }
  return accountId;
}

/**
 * LuÃ´n resolve numeric Facebook ID â€” dÃ¹ng lÃ m tÃªn thÆ° má»¥c lÆ°u media.
 * KhÃ´ng fallback vá» internal UUID: náº¿u service null hoáº·c chÆ°a init,
 * tra DB Ä‘á»ƒ láº¥y facebook_id tháº­t.
 */
function resolveRealFacebookId(internalId: string, service: any): string {
  const fbId = service?.getRealFacebookId();
  if (fbId) return fbId;
  const fbAcc = DatabaseService.getInstance().getFBAccount(internalId);
  return fbAcc?.facebook_id || internalId;
}

/** Open-source build: giá»¯ hÃ m Ä‘á»ƒ khÃ´ng vá»¡ import á»Ÿ main process. */
export function setFBMainWindow(_win: any) {}

/**
 * Láº¥y FacebookService tá»« ConnectionManager, tá»± Ä‘á»™ng reconnect náº¿u chÆ°a cÃ³.
 * Táº¥t cáº£ handlers gá»i hÃ m nÃ y thay vÃ¬ FacebookConnectionManager.get() trá»±c tiáº¿p.
 * TrÃ¡nh lá»—i "Account not connected" khi máº¡ng drop rá»“i online láº¡i nhÆ°ng
 * ConnectionManager chÆ°a ká»‹p Ä‘á»“ng bá»™.
 */
async function getFBServiceOrReconnect(internalId: string): Promise<FacebookService | null> {
  let service = FacebookConnectionManager.get(internalId);
  if (service) return service;

  Logger.warn(`[facebookIpc] Service ${internalId} not in ConnectionManager â€” attempting auto-reconnect...`);
  const account = DatabaseService.getInstance().getFBAccount(internalId);
  if (!account) return null;

  const cookie = secureGet(fbCookieKey(internalId)) || account.cookie_encrypted;
  if (!cookie) return null;

  let proxyId: number | null | undefined;
  try {
    const accRow = DatabaseService.getInstance().queryOne<any>('SELECT proxy_id FROM accounts WHERE zalo_id = ?', [account.facebook_id || internalId]);
    proxyId = accRow?.proxy_id ?? null;
  } catch { proxyId = null; }

  try {
    service = await FacebookConnectionManager.getOrCreate(internalId, cookie, proxyId);
    Logger.log(`[facebookIpc] Auto-reconnect success for ${internalId}`);
    return service;
  } catch (err: any) {
    Logger.warn(`[facebookIpc] Auto-reconnect failed for ${internalId}: ${err.message}`);
    return null;
  }
}

// â”€â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function registerFacebookIpc(): void {

  /**
   * Shared helper: verify cookie, save account to DB, connect.
   * DÃ¹ng chung cho cáº£ cookie-based vÃ  credentials-based login.
   */
  async function _addFBAccountCommon(cookie: string, proxyId: number | null | undefined): Promise<{
    success: boolean; account?: any; facebookId?: string; name?: string; error?: string;
  }> {
    // Resolve proxy agent Ä‘á»ƒ dÃ¹ng cho initSession
    let httpsAgent: any = undefined;
    if (proxyId) {
      try {
        const proxy = DatabaseService.getInstance().getProxyById(proxyId);
        if (proxy) {
          const { createProxyAgent } = require('../../src/utils/ProxyHelper');
          httpsAgent = createProxyAgent(proxy);
        }
      } catch {}
    }

    // 1. Verify cookie alive + init session (with proxy)
    const sessionData = await initSession(cookie, httpsAgent);
    const fbId = sessionData.FacebookID;

    if (!fbId || fbId === '0' || fbId.includes('Unable') || !fbId.match(/^\d+$/)) {
      return { success: false, error: 'Cookie khÃ´ng há»£p lá»‡ hoáº·c Ä‘Ã£ háº¿t háº¡n. Vui lÃ²ng Ä‘Äƒng nháº­p láº¡i Facebook vÃ  copy cookie má»›i.' };
    }

    // 2. Náº¿u account Ä‘Ã£ tá»“n táº¡i (trong fb_accounts), xoÃ¡ record cÅ© Ä‘á»ƒ thÃªm láº¡i
    const existing = DatabaseService.getInstance().getFBAccounts()
      .find((a: any) => a.facebook_id === fbId);
    if (existing) {
      Logger.log(`[facebookIpc] _addFBAccountCommon â€” account ${fbId} Ä‘Ã£ tá»“n táº¡i, xoÃ¡ cÅ© vÃ  thÃªm láº¡i`);
      await FacebookConnectionManager.disconnect(existing.id).catch(() => {});
      secureDelete(fbCookieKey(existing.id));
      DatabaseService.getInstance().deleteFBAccount(existing.id);
      DatabaseService.getInstance().deleteAccount(fbId);
    }

    // 3. Láº¥y tÃªn + avatar
    let name = fbId;
    let avatarUrl = '';
    try {
      const html = await fetchFBHomepage(cookie);
      const profile = await fetchBasicProfileFromHome(html);
      name = profile.name || fbId;
      avatarUrl = profile.avatarUrl || '';
    } catch {}

    // 4. LÆ°u vÃ o DB (cookie mÃ£ hÃ³a)
    const accountId = uuid();
    secureSet(fbCookieKey(accountId), cookie);

    DatabaseService.getInstance().saveFBAccount({
      id: accountId,
      facebook_id: fbId,
      name,
      avatar_url: avatarUrl,
      cookie_encrypted: cookie,
      session_data: JSON.stringify(sessionData),
      status: 'disconnected',
    });

    // Also sync to unified accounts table â€” use fbId as zalo_id (for license matching)
    DatabaseService.getInstance()['run'](
      `INSERT INTO accounts (zalo_id, full_name, avatar_url, phone, is_business, imei, user_agent, cookies, is_active, channel, proxy_id, created_at)
       VALUES (?, ?, ?, '', 0, '', '', '', 1, 'facebook', ?, datetime('now'))
       ON CONFLICT(zalo_id) DO UPDATE SET
         full_name = excluded.full_name, avatar_url = excluded.avatar_url,
         channel = 'facebook', is_active = 1, proxy_id = excluded.proxy_id`,
      [fbId, name, avatarUrl, proxyId ?? null]
    );

    // 5. Connect (with proxy) â€” getOrCreate Ä‘Ã£ tá»± Ä‘á»™ng connect
    await FacebookConnectionManager.getOrCreate(accountId, cookie, proxyId);

    const account = DatabaseService.getInstance().getFBAccount(accountId);
    return { success: true, account, facebookId: fbId, name };
  }

  /**
   * ThÃªm tÃ i khoáº£n Facebook báº±ng cookie
   */
  ipcMain.handle('fb:addAccount', async (_event, { cookie, proxyId }: { cookie: string; proxyId?: number | null }) => {
    try {
      return await _addFBAccountCommon(cookie, proxyId);
    } catch (err: any) {
      Logger.error(`[facebookIpc] fb:addAccount error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * ThÃªm tÃ i khoáº£n Facebook báº±ng username/password (+ 2FA optional)
   * Gá»i loginWithCredentials â†’ láº¥y cookie â†’ táº¡o account qua _addFBAccountCommon
   */
  ipcMain.handle('fb:addAccountWithCredentials', async (_event, params: {
    username: string; password: string; twoFASecret?: string; proxyId?: number | null;
  }) => {
    try {
      // Resolve proxy agent cho loginWithCredentials
      let httpsAgent: any = undefined;
      if (params.proxyId) {
        try {
          const proxy = DatabaseService.getInstance().getProxyById(params.proxyId);
          if (proxy) {
            const { createProxyAgent } = require('../../src/utils/ProxyHelper');
            httpsAgent = createProxyAgent(proxy);
          }
        } catch {}
      }

      // 1. ÄÄƒng nháº­p láº¥y cookie
      const loginResult = await loginWithCredentials(
        params.username, params.password, params.twoFASecret, httpsAgent
      );

      // 2FA challenge â€” yÃªu cáº§u UI cung cáº¥p twoFASecret
      if (loginResult.error?.error_subcode === 1348162) {
        return {
          success: false,
          need2FA: true,
          error: loginResult.error.description || 'TÃ i khoáº£n yÃªu cáº§u xÃ¡c thá»±c 2 yáº¿u tá»‘ (2FA). Vui lÃ²ng nháº­p mÃ£ bÃ­ máº­t 2FA.',
          errorTitle: loginResult.error.title,
        };
      }

      // Lá»—i Ä‘Äƒng nháº­p khÃ¡c (sai máº­t kháº©u, checkpoint, ...)
      if (!loginResult.success) {
        Logger.warn(`[facebookIpc] loginWithCredentials failed:`, JSON.stringify(loginResult.error));
        return {
          success: false,
          error: loginResult.error?.description || loginResult.error?.title || 'ÄÄƒng nháº­p tháº¥t báº¡i',
          errorTitle: loginResult.error?.title,
        };
      }

      // 2. ThÃ nh cÃ´ng â€” táº¡o account vá»›i cookie vá»«a láº¥y Ä‘Æ°á»£c
      const cookie = loginResult.success.setCookies;
      if (!cookie) {
        return { success: false, error: 'ÄÄƒng nháº­p thÃ nh cÃ´ng nhÆ°ng khÃ´ng láº¥y Ä‘Æ°á»£c cookie.' };
      }

      return await _addFBAccountCommon(cookie, params.proxyId);
    } catch (err: any) {
      Logger.error(`[facebookIpc] fb:addAccountWithCredentials error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * XÃ³a tÃ i khoáº£n Facebook
   */
  ipcMain.handle('fb:removeAccount', async (_event, { accountId }: { accountId: string }) => {
    try {
      const internalId = resolveInternalId(accountId);
      await FacebookConnectionManager.disconnect(internalId);
      secureDelete(fbCookieKey(internalId));
      DatabaseService.getInstance().deleteFBAccount(internalId);
      // Also remove from unified accounts table (zalo_id = fbId)
      DatabaseService.getInstance().deleteAccount(accountId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Cáº­p nháº­t cookie cho tÃ i khoáº£n Facebook hiá»‡n cÃ³
   */
  ipcMain.handle('fb:updateCookie', async (_event, { accountId, cookie }: { accountId: string; cookie: string }) => {
    try {
      const internalId = resolveInternalId(accountId);
      const account = DatabaseService.getInstance().getFBAccount(internalId);
      if (!account) return { success: false, error: 'TÃ i khoáº£n khÃ´ng tá»“n táº¡i' };

      // Verify cookie alive + init session
      const sessionData = await initSession(cookie);
      const fbId = sessionData.FacebookID;
      if (!fbId || !fbId.match(/^\d+$/) || fbId.includes('Unable')) {
        return { success: false, error: 'Cookie khÃ´ng há»£p lá»‡ hoáº·c Ä‘Ã£ háº¿t háº¡n' };
      }

      // Fetch updated profile
      let name = account.name || fbId;
      let avatarUrl = account.avatar_url || '';
      try {
        const html = await fetchFBHomepage(cookie);
        const profile = await fetchBasicProfileFromHome(html);
        if (profile.name) name = profile.name;
        if (profile.avatarUrl) avatarUrl = profile.avatarUrl;
      } catch {}

      // Update cookie in secure storage
      secureSet(fbCookieKey(internalId), cookie);

      // Update cookie_encrypted fallback (raw cookie) Ä‘á»ƒ reconnect váº«n hoáº¡t Ä‘á»™ng
      // khi safeStorage key thay Ä‘á»•i
      DatabaseService.getInstance().run(
        `UPDATE fb_accounts SET cookie_encrypted = ?, updated_at = ? WHERE id = ?`,
        [cookie, Date.now(), internalId]
      );

      // Update session + profile
      DatabaseService.getInstance().updateFBAccountSession(internalId, JSON.stringify(sessionData));
      DatabaseService.getInstance().updateFBAccountProfile(internalId, name, avatarUrl, fbId);

      // Update unified accounts table (zalo_id = fbId)
      DatabaseService.getInstance()['run'](
        `UPDATE accounts SET full_name = ?, avatar_url = ? WHERE zalo_id = ?`,
        [name, avatarUrl, fbId]
      );

      Logger.log(`[facebookIpc] fb:updateCookie success for ${internalId}`);
      return { success: true };
    } catch (err: any) {
      Logger.error(`[facebookIpc] fb:updateCookie error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Refresh profile (tÃªn, avatar) cho tÃ i khoáº£n Facebook hiá»‡n cÃ³
   */
  ipcMain.handle('fb:refreshProfile', async (_event, { accountId }: { accountId: string }) => {
    try {
      const internalId = resolveInternalId(accountId);
      const account = DatabaseService.getInstance().getFBAccount(internalId);
      if (!account) return { success: false, error: 'TÃ i khoáº£n khÃ´ng tá»“n táº¡i' };

      const cookie = secureGet(fbCookieKey(internalId)) || account.cookie_encrypted;
      if (!cookie) return { success: false, error: 'KhÃ´ng tÃ¬m tháº¥y cookie. Vui lÃ²ng cáº­p nháº­t cookie.' };

      let name = account.name || account.facebook_id;
      let avatarUrl = account.avatar_url || '';
      try {
        const html = await fetchFBHomepage(cookie);
        const profile = await fetchBasicProfileFromHome(html);
        if (profile.name) name = profile.name;
        if (profile.avatarUrl) avatarUrl = profile.avatarUrl;
      } catch (err: any) {
        Logger.warn(`[facebookIpc] fb:refreshProfile fetch error: ${err.message}`);
      }

      // Update FB account table
      DatabaseService.getInstance().updateFBAccountProfile(internalId, name, avatarUrl, account.facebook_id);

      // Update unified accounts table (zalo_id = fbId)
      DatabaseService.getInstance()['run'](
        `UPDATE accounts SET full_name = ?, avatar_url = ? WHERE zalo_id = ?`,
        [name, avatarUrl, account.facebook_id]
      );

      Logger.log(`[facebookIpc] fb:refreshProfile success for ${account.facebook_id}: ${name}`);
      return { success: true, name, avatarUrl, facebookId: account.facebook_id };
    } catch (err: any) {
      Logger.error(`[facebookIpc] fb:refreshProfile error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Refresh avatar cho 1 contact Facebook (user 1-1).
   * DÃ¹ng khi avatar CDN háº¿t háº¡n (403). Re-fetch thread list tá»« GraphQL
   * Ä‘á»ƒ láº¥y avatar URL má»›i, update DB, tráº£ vá» URL.
   */
  ipcMain.handle('fb:refreshContactAvatar', async (_event, { accountId, userId }: { accountId: string; userId: string }) => {
    try {
      const internalId = resolveInternalId(accountId);
      const cookie = secureGet(fbCookieKey(internalId));
      if (!cookie) return { success: false, error: 'KhÃ´ng tÃ¬m tháº¥y cookie. Vui lÃ²ng cáº­p nháº­t cookie.', avatarUrl: null };

      const service = FacebookConnectionManager.get(internalId);
      if (!service || !service.isConnected()) {
        // Náº¿u service chÆ°a connect, váº«n cÃ³ thá»ƒ gá»i refreshContactAvatar
        // báº±ng cÃ¡ch táº¡o temporary service khÃ´ng persistent
        return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i', avatarUrl: null };
      }

      const avatarUrl = await service.refreshContactAvatar(userId);
      if (avatarUrl) {
        return { success: true, avatarUrl };
      }
      return { success: false, error: 'KhÃ´ng thá»ƒ láº¥y avatar má»›i', avatarUrl: null };
    } catch (err: any) {
      Logger.error(`[facebookIpc] fb:refreshContactAvatar error: ${err.message}`);
      return { success: false, error: err.message, avatarUrl: null };
    }
  });

  /**
   * Láº¥y thÃ´ng tin user (tÃªn + avatar) tá»« Facebook profile HTML
   * DÃ¹ng cho E2EE / há»™i thoáº¡i má»›i khÃ´ng cÃ³ contact info
   */
  ipcMain.handle('fb:getUserInfoFacebookHtml', async (_event, { accountId, userId }: { accountId: string; userId: string }) => {
    try {
      // Chá»‰ cho phÃ©p user ID dáº¡ng sá»‘ (khÃ´ng pháº£i group chat)
      if (!/^\d+$/.test(userId)) return { success: false, error: 'Chá»‰ há»— trá»£ user 1-1' };
      const internalId = resolveInternalId(accountId);
      const cookie = secureGet(fbCookieKey(internalId));
      if (!cookie) return { success: false, error: 'Cookie not found' };
      const info = await getUserInfoFacebookHtml(cookie, userId);
      if (info) {
        Logger.log(`[facebookIpc] fb:getUserInfoFacebookHtml: resolved ${userId} â†’ name="${info.name}"`);
        // LÆ°u vÃ o DB náº¿u cÃ³ tÃªn
        if (info.name) {
          DatabaseService.getInstance()['run']?.(
            `UPDATE contacts SET display_name = ?, avatar_url = ? WHERE owner_zalo_id = ? AND contact_id = ? AND channel = 'facebook'`,
            [info.name, info.avatarUrl || null, internalId, userId]
          );
        }
        return { success: true, name: info.name, avatarUrl: info.avatarUrl };
      }
      return { success: false, error: 'KhÃ´ng thá»ƒ láº¥y thÃ´ng tin user' };
    } catch (err: any) {
      Logger.error(`[facebookIpc] fb:getUserInfoFacebookHtml error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Láº¥y danh sÃ¡ch tÃ i khoáº£n FB
   */
  ipcMain.handle('fb:getAccounts', async () => {
    try {
      const accounts = DatabaseService.getInstance().getFBAccounts();
      return { success: true, accounts };
    } catch (err: any) {
      return { success: false, accounts: [], error: err.message };
    }
  });

  /**
   * Connect MQTT listener cho account
   */
  ipcMain.handle('fb:connect', async (_event, { accountId }: { accountId: string }) => {
    try {

      const internalId = resolveInternalId(accountId);
      const account = DatabaseService.getInstance().getFBAccount(internalId);
      if (!account) return { success: false, error: 'Account not found' };

      // Äá»c proxyId tá»« unified accounts table
      let proxyId: number | null | undefined;
      try {
        const accRow = DatabaseService.getInstance().queryOne<any>('SELECT proxy_id FROM accounts WHERE zalo_id = ?', [account.facebook_id || accountId]);
        proxyId = accRow?.proxy_id ?? null;
      } catch { proxyId = null; }

      // Test cookie health trÆ°á»›c
      const cookie = secureGet(fbCookieKey(internalId)) || account.cookie_encrypted;
      if (!cookie) return { success: false, error: 'No cookie found for this account' };

      try {
        const { checkCookieAlive } = require('../../src/services/facebook/FacebookSession');
        const alive = await checkCookieAlive(cookie);
        if (!alive) return { success: false, error: 'Cookie Ä‘Ã£ háº¿t háº¡n. Vui lÃ²ng Ä‘Äƒng nháº­p láº¡i Facebook vÃ  copy cookie má»›i.' };
      } catch (healthErr: any) {
        Logger.warn(`[facebookIpc] fb:connect health check failed: ${healthErr.message}, proceeding anyway`);
      }

      const service = await FacebookConnectionManager.getOrCreate(internalId, cookie, proxyId);

      // Reset retry count Ä‘á»ƒ láº§n máº¥t káº¿t ná»‘i sau báº¯t Ä‘áº§u láº¡i tá»« attempt 0
      if (service.isConnected()) {
        service.resetListenerRetryCount?.();
        DatabaseService.getInstance().setListenerActive(account.facebook_id || internalId, true);
        Logger.log(`[facebookIpc] fb:connect ${internalId}: connected + retry reset`);
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Disconnect MQTT listener
   */
  ipcMain.handle('fb:disconnect', async (_event, { accountId }: { accountId: string }) => {
    try {
      const internalId = resolveInternalId(accountId);
      await FacebookConnectionManager.disconnect(internalId);
      DatabaseService.getInstance().updateFBAccountStatus(internalId, 'disconnected');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Health check
   */
  ipcMain.handle('fb:checkHealth', async (_event, { accountId }: { accountId: string }) => {
    try {
      const internalId = resolveInternalId(accountId);
      const service = FacebookConnectionManager.get(internalId);
      if (!service) return { success: true, alive: false, listenerConnected: false, reason: 'not_initialized' };
      const health = await service.checkHealth();
      return { success: true, ...health };
    } catch (err: any) {
      return { success: false, alive: false, listenerConnected: false, error: err.message };
    }
  });

  /**
   * Gá»­i tin nháº¯n (C1: auto-route 1:1 qua E2EE)
   * DÃ¹ng chung FacebookSendService.sendTextMessage() vá»›i workflow engine.
   */
   ipcMain.handle('fb:sendMessage', async (_event, params: {
    accountId: string; threadId: string; body: string; options?: any;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      Logger.log(`[facebookIpc] fb:sendMessage accountId=${params.accountId} â†’ internalId=${internalId} threadId=${params.threadId} body="${params.body?.slice(0,50)}"`);

      // Auto-reconnect náº¿u service chÆ°a cÃ³ trong ConnectionManager
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) {
        return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      }

      const { FacebookSendService } = require('../../src/services/facebook/FacebookSendService');

      // â”€â”€ Timeout guard: prevent UI hanging forever â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // 15s cho háº§u háº¿t trÆ°á»ng há»£p, náº¿u group MQTT treo cÅ©ng khÃ´ng chá» quÃ¡ lÃ¢u.
      const TIMEOUT_MS = 15000;
      const result = (await Promise.race([
        FacebookSendService.sendTextMessage({
          accountId: internalId,
          threadId: params.threadId,
          body: params.body,
          typeChat: params.options?.typeChat,
          replyToMessageId: params.options?.replyToMessageId,
        }),
        new Promise<any>((_, reject) =>
          setTimeout(() => reject(new Error(`Gá»­i tin nháº¯n timeout sau ${TIMEOUT_MS / 1000}s. Vui lÃ²ng thá»­ láº¡i.`)), TIMEOUT_MS)
        ),
      ])) as any;

      return result;
    } catch (err: any) {
      Logger.error(`[facebookIpc] fb:sendMessage error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Gá»­i attachment (C2: auto-route 1:1 qua E2EE)
   */
  ipcMain.handle('fb:sendAttachment', async (_event, params: {
    accountId: string; threadId: string; filePath: string; body?: string; typeChat?: 'user' | null; fileType?: 'image' | 'video' | 'audio' | 'file';
    replyToMessageId?: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };

      // C2: 1:1 â†’ gá»­i qua E2EE bridge
      const isUserMessage = params.typeChat === 'user';
      if (isUserMessage) {
        if (!service.isE2EEConnected()) {
          try {
            await service.retryE2EE();
          } catch {}
        }
        if (!service.isE2EEConnected()) {
          return {
            success: false,
            error: 'KhÃ´ng thá»ƒ gá»­i file 1:1 trÃªn Facebook: E2EE bridge chÆ°a káº¿t ná»‘i. ' +
              'Build binary: clone mautrix/meta vÃ o bridge-e2ee/, cháº¡y go build, ' +
              'hoáº·c set biáº¿n mÃ´i trÆ°á»ng FBCHAT_E2EE_BIN',
          };
        }

        const { normalizeChatJid } = require('../../src/services/facebook/FacebookUtils');
        const chatJid = normalizeChatJid(params.threadId);
        const fileName = require('path').basename(params.filePath);
        // Æ¯u tiÃªn fileType hint tá»« renderer (voice recording gá»­i fileType='audio' Ä‘á»ƒ trÃ¡nh nháº§m .webm lÃ  video)
        const isImage = params.fileType === 'image' || (!params.fileType && /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(fileName));
        const isVideo = params.fileType === 'video' || (!params.fileType && /\.(mp4|webm|mov|avi)$/i.test(fileName));
        const isAudio = params.fileType === 'audio' || (!params.fileType && /\.(mp3|wav|ogg|m4a|aac|flac|wma)$/i.test(fileName));

        let result: any;
        if (isImage) {
          result = await service.sendE2EEImage(chatJid, params.filePath, params.body);
        } else if (isVideo) {
          result = await service.sendE2EEVideo(chatJid, params.filePath, params.body);
        } else if (isAudio) {
          result = await service.sendE2EEAudio(chatJid, params.filePath);
        } else {
          result = await service.sendE2EEFile(chatJid, params.filePath, fileName);
        }

        Logger.log(`[facebookIpc] fb:sendAttachment E2EE 1:1 FULL response: ${JSON.stringify(result)}`);

        // Bridge does NOT echo self-sent messages â†’ save message directly
        // with localPath to the original file so UI can display immediately
        if (result.success && result.messageId) {
          try {
            const attachType = isImage ? 'image' : isVideo ? 'video' : isAudio ? 'audio' : 'file';
            const fbId = resolveRealFacebookId(internalId, service);

            // Copy sent file to media storage
            let localRelPath: string | undefined;
            try {
              const fs = require('fs');
              const buffer = fs.readFileSync(params.filePath);
              const ext = require('path').extname(fileName) || '.bin';
              const savedName = `sent_${result.messageId.slice(-8)}_${Date.now()}${ext}`;
              const absPath = await FileStorageService.saveBuffer(fbId, buffer, savedName);
              localRelPath = FileStorageService.toRelativePath(absPath);
              Logger.log(`[facebookIpc] E2EE sent media saved: ${localRelPath}`);
            } catch (fsErr: any) {
              Logger.warn(`[facebookIpc] E2EE sent media copy failed: ${fsErr.message}`);
            }

            // Save message to DB with localPath in attachments
            // body = null for media messages â€” DB's saveFBMessage auto-generates displayContent
            DatabaseService.getInstance().saveFBMessage({
              id: result.messageId,
              account_id: internalId,
              thread_id: params.threadId,
              sender_id: fbId,
              body: params.body || null,
              timestamp: result.timestamp || Date.now(),
              type: attachType,
              attachments: JSON.stringify([{
                type: attachType,
                name: fileName,
                ...(localRelPath ? { localPath: localRelPath } : {}),
              }]),
              is_self: 1,
              is_unsent: 0,
              ...(params.replyToMessageId ? { reply_to_id: params.replyToMessageId } : {}),
            });

            // Update local_paths in unified messages table
            if (localRelPath) {
              DatabaseService.getInstance().updateLocalPaths(fbId, result.messageId, { main: localRelPath });
            }

            // Notify UI: add message to chat store + set localPath for image render
            EventBroadcaster.emit('fb:onMessage', {
              fbAccountId: fbId,
              message: {
                messageID: result.messageId,
                replyToID: params.threadId,
                body: null,
                userID: fbId,
                timestamp: String(result.timestamp || Date.now()),
                type: 'user',
                attachments: {
                  id: 1,
                  url: null,
                  attachmentType: attachType,
                  name: fileName,
                  ...(localRelPath ? { localPath: localRelPath } : {}),
                },
                isSelf: true,
                ...(params.replyToMessageId ? { replyToMessageId: params.replyToMessageId } : {}),
              },
            });
            if (localRelPath) {
              EventBroadcaster.emit('event:localPath', {
                zaloId: fbId,
                msgId: result.messageId,
                threadId: params.threadId,
                localPaths: { main: localRelPath },
              });
            }
          } catch (dbErr: any) {
            Logger.warn(`[facebookIpc] E2EE self-save error: ${dbErr.message}`);
          }
        }
        return { ...result, fileName };
      }

      // Group: upload + send via REST (existing logic)
      const uploaded = await service.uploadAttachment(params.filePath);
      if (!uploaded) return { success: false, error: 'Upload tháº¥t báº¡i' };

      const attachType = uploaded.attachmentType.startsWith('image') ? 'image'
        : uploaded.attachmentType.startsWith('video') ? 'video'
        : uploaded.attachmentType.startsWith('audio') ? 'audio'
        : 'file';

      let result = await service.sendMessage(params.threadId, params.body || '', {
        typeAttachment: attachType as any,
        attachmentId: uploaded.attachmentId,
        typeChat: params.typeChat,
        ...(params.replyToMessageId ? { replyToMessageId: params.replyToMessageId } : {}),
      });

      // E2EE error detection â†’ retry via bridge. Handles case where typeChat was not set
      // but conversation is actually E2EE-encrypted 1:1.
      if (!result.success && /disabled|vÃ´ hiá»‡u hoÃ¡|encrypted/i.test(result.error || '')) {
        Logger.warn(`[facebookIpc] fb:sendAttachment E2EE error detected, retrying via bridge for thread=${params.threadId}`);
        if (!service.isE2EEConnected()) {
          try { await service.retryE2EE(); } catch {}
        }
        if (service.isE2EEConnected()) {
          const { normalizeChatJid } = require('../../src/services/facebook/FacebookUtils');
          const chatJid = normalizeChatJid(params.threadId);
          const isImage = params.fileType === 'image' || /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(require('path').basename(params.filePath));
          const isVideo = params.fileType === 'video' || /\.(mp4|webm|mov|avi)$/i.test(require('path').basename(params.filePath));
          const isAudio = params.fileType === 'audio' || /\.(mp3|wav|ogg|m4a|aac|flac|wma)$/i.test(require('path').basename(params.filePath));
          result = isImage
            ? await service.sendE2EEImage(chatJid, params.filePath, params.body)
            : isVideo
              ? await service.sendE2EEVideo(chatJid, params.filePath, params.body)
              : isAudio
                ? await service.sendE2EEAudio(chatJid, params.filePath)
                : await service.sendE2EEFile(chatJid, params.filePath, require('path').basename(params.filePath));
        }
      }

      // Save sent attachment message to DB immediately
      if (result.success && result.messageId) {
        try {
          const fileName = require('path').basename(params.filePath);
          const bodyPreview = attachType === 'image' ? 'ðŸ–¼ï¸ HÃ¬nh áº£nh'
            : attachType === 'video' ? 'ðŸŽ¬ Video'
            : attachType === 'audio' ? 'ðŸŽµ Audio'
            : `ðŸ“Ž ${fileName}`;
          DatabaseService.getInstance().saveFBMessage({
            id: result.messageId,
            account_id: internalId,
            thread_id: params.threadId,
            sender_id: resolveRealFacebookId(internalId, service),
            body: params.body || bodyPreview,
            timestamp: result.timestamp || Date.now(),
            type: attachType,
            attachments: JSON.stringify([{
              type: attachType,
              id: uploaded.attachmentId,
              name: fileName,
              url: uploaded.attachmentUrl || null,
            }]),
            is_self: 1,
            is_unsent: 0,
            ...(params.replyToMessageId ? { reply_to_id: params.replyToMessageId } : {}),
          });
        } catch (dbErr: any) {
          Logger.warn(`[facebookIpc] fb:sendAttachment DB save error: ${dbErr.message}`);
        }
      }

      return { ...result, fileName: require('path').basename(params.filePath) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Gá»­i nhiá»u áº£nh/file cÃ¹ng 1 request (batch attachments)
   */
  ipcMain.handle('fb:sendAttachments', async (_event, params: {
    accountId: string; threadId: string; filePaths: string[]; body?: string; typeChat?: 'user' | null;
    replyToMessageId?: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };

      // C2: 1:1 â†’ gá»­i qua E2EE bridge
      const isUserMessage = params.typeChat === 'user';
      if (isUserMessage) {
        if (!service.isE2EEConnected()) {
          try { await service.retryE2EE(); } catch {}
        }
        if (!service.isE2EEConnected()) {
          return {
            success: false, uploadedCount: 0, totalCount: params.filePaths.length,
            error: 'KhÃ´ng thá»ƒ gá»­i file 1:1: E2EE bridge chÆ°a káº¿t ná»‘i.',
          };
        }

        const { normalizeChatJid } = require('../../src/services/facebook/FacebookUtils');
        const chatJid = normalizeChatJid(params.threadId);
        const path = require('path');
        const results: Array<{ success: boolean; messageId?: string; timestamp?: number; filePath: string; fileName: string; isImage: boolean; isVideo: boolean; isAudio: boolean }> = [];
        let failCount = 0;

        // Gá»­i tá»«ng file qua E2EE bridge, collect all results
        for (const fp of params.filePaths) {
          const fileName = path.basename(fp);
          const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(fileName);
          const isVideo = /\.(mp4|webm|mov|avi)$/i.test(fileName);
          const isAudio = /\.(mp3|wav|ogg|m4a|aac|flac|wma)$/i.test(fileName);
          let r: any;
          if (isImage) {
            r = await service.sendE2EEImage(chatJid, fp, params.body);
          } else if (isVideo) {
            r = await service.sendE2EEVideo(chatJid, fp, params.body);
          } else if (isAudio) {
            r = await service.sendE2EEAudio(chatJid, fp);
          } else {
            r = await service.sendE2EEFile(chatJid, fp, fileName);
          }
          if (!r.success) { failCount++; }
          results.push({ ...r, filePath: fp, fileName, isImage, isVideo, isAudio });
        }

        const fbId = resolveRealFacebookId(internalId, service);

        // Save each successfully sent image as its own message (bridge echoes separately)
        for (const r of results) {
          if (!r.success || !r.messageId) continue;
          Logger.log(`[facebookIpc] fb:sendAttachments E2EE saving msgId=${r.messageId} file=${r.fileName}`);
          try {
            const attachType = r.isImage ? 'image' : r.isVideo ? 'video' : r.isAudio ? 'audio' : 'file';

            // Copy sent file to media storage
            let localRelPath: string | undefined;
            try {
              const buffer = require('fs').readFileSync(r.filePath);
              const ext = path.extname(r.fileName) || '.bin';
              const savedName = `sent_${r.messageId.slice(-8)}_${Date.now()}${ext}`;
              const absPath = await FileStorageService.saveBuffer(fbId, buffer, savedName);
              localRelPath = FileStorageService.toRelativePath(absPath);
              Logger.log(`[facebookIpc] E2EE batch sent media saved: ${localRelPath}`);
            } catch (fsErr: any) {
              Logger.warn(`[facebookIpc] E2EE batch media copy failed for ${r.fileName}: ${fsErr.message}`);
            }

            DatabaseService.getInstance().saveFBMessage({
              id: r.messageId,
              account_id: internalId,
              thread_id: params.threadId,
              sender_id: fbId,
              body: params.body || null,
              timestamp: r.timestamp || Date.now(),
              type: attachType,
              attachments: JSON.stringify([{
                type: attachType,
                name: r.fileName,
                ...(localRelPath ? { localPath: localRelPath } : {}),
              }]),
              is_self: 1,
              is_unsent: 0,
              ...(params.replyToMessageId ? { reply_to_id: params.replyToMessageId } : {}),
            });

            if (localRelPath) {
              DatabaseService.getInstance().updateLocalPaths(fbId, r.messageId, { main: localRelPath });
            }

            EventBroadcaster.emit('fb:onMessage', {
              fbAccountId: fbId,
              message: {
                messageID: r.messageId,
                replyToID: params.threadId,
                body: null,
                userID: fbId,
                timestamp: String(r.timestamp || Date.now()),
                type: 'user',
                attachments: {
                  id: 1,
                  url: null,
                  attachmentType: attachType,
                  name: r.fileName,
                  ...(localRelPath ? { localPath: localRelPath } : {}),
                },
                isSelf: true,
                ...(params.replyToMessageId ? { replyToMessageId: params.replyToMessageId } : {}),
              },
            });
            if (localRelPath) {
              EventBroadcaster.emit('event:localPath', {
                zaloId: fbId,
                msgId: r.messageId,
                threadId: params.threadId,
                localPaths: { main: localRelPath },
              });
            }
          } catch (dbErr: any) {
            Logger.warn(`[facebookIpc] fb:sendAttachments E2EE save error for ${r.fileName}: ${dbErr.message}`);
          }
        }

        return {
          success: failCount < params.filePaths.length,
          uploadedCount: params.filePaths.length - failCount,
          totalCount: params.filePaths.length,
        };
      }

      // Group: upload + send via REST (existing logic)
      // 1. Upload all files in parallel
      const uploadResults = await Promise.all(
        params.filePaths.map(fp => service.uploadAttachment(fp))
      );
      const successful = uploadResults
        .map((u, i) => u ? { uploaded: u, filePath: params.filePaths[i] } : null)
        .filter(Boolean) as Array<{ uploaded: any; filePath: string }>;

      if (successful.length === 0) return { success: false, error: 'Táº¥t cáº£ upload tháº¥t báº¡i' };

      // 2. Send ONE message with all attachment IDs
      const attachmentIds = successful.map(({ uploaded }) => {
        const t = uploaded.attachmentType?.startsWith('image') ? 'image'
          : uploaded.attachmentType?.startsWith('video') ? 'video'
          : uploaded.attachmentType?.startsWith('audio') ? 'audio'
          : 'file';
        return { id: uploaded.attachmentId, type: t as any };
      });

      const result = await service.sendMessage(params.threadId, params.body || '', {
        attachmentIds,
        typeChat: params.typeChat,
        ...(params.replyToMessageId ? { replyToMessageId: params.replyToMessageId } : {}),
      });

      // 3. Save to DB â€” MQTT echo may have already inserted with partial attachments (race),
      //    so save first then force-UPDATE attachments to ensure all images are stored.
      if (result.success && result.messageId) {
        try {
          const path = require('path');
          const allAttachmentsJson = JSON.stringify(successful.map(({ uploaded, filePath }) => ({
            type: attachmentIds.find(a => a.id === uploaded.attachmentId)?.type || 'image',
            id: uploaded.attachmentId,
            name: path.basename(filePath),
            url: uploaded.attachmentUrl || null,
          })));
          const db = DatabaseService.getInstance();
          db.saveFBMessage({
            id: result.messageId,
            account_id: internalId,
            thread_id: params.threadId,
            sender_id: resolveRealFacebookId(internalId, service),
            body: params.body || 'ðŸ–¼ï¸ HÃ¬nh áº£nh',
            timestamp: result.timestamp || Date.now(),
            type: 'image',
            attachments: allAttachmentsJson,
            is_self: 1,
            is_unsent: 0,
            ...(params.replyToMessageId ? { reply_to_id: params.replyToMessageId } : {}),
          });
          // Force-update attachments in case MQTT echo already inserted with partial data
          db.run?.(`UPDATE messages SET attachments = ? WHERE msg_id = ?`, [allAttachmentsJson, result.messageId]);
          db.run?.(`UPDATE fb_messages SET attachments = ? WHERE id = ?`, [allAttachmentsJson, result.messageId]);
          Logger.log(`[facebookIpc] fb:sendAttachments saved ${successful.length} attachments for ${result.messageId}`);
        } catch (dbErr: any) {
          Logger.warn(`[facebookIpc] fb:sendAttachments DB save error: ${dbErr.message}`);
        }
      }

      return { ...result, uploadedCount: successful.length, totalCount: params.filePaths.length };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Thu há»“i tin nháº¯n
   */
  ipcMain.handle('fb:unsendMessage', async (_event, params: {
    accountId: string; messageId: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      const result = await service.unsendMessage(params.messageId);
      if (result.success) {
        DatabaseService.getInstance().updateFBMessageUnsent(params.messageId);
      }
      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Reaction (C3: auto-route 1:1 E2EE reactions qua bridge)
   */
  ipcMain.handle('fb:addReaction', async (_event, params: {
    accountId: string; messageId: string; emoji: string; action: 'add' | 'remove';
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };

      let success = false;

      // Try bridge reaction first (works for group via sendReaction)
      if (service.isE2EEConnected()) {
        // Look up thread_id from message DB for context
        const db = DatabaseService.getInstance();
        const msg = db.queryOne?.('SELECT thread_id, sender_id FROM fb_messages WHERE id = ? AND account_id = ?',
          [params.messageId, internalId]) as any;

        if (msg?.thread_id) {
          // Thread ID is numeric (all digits) = 1:1 E2EE chat â†’ route via E2EE reaction
          if (/^\d+$/.test(msg.thread_id)) {
            const { normalizeChatJid } = require('../../src/services/facebook/FacebookUtils');
            const chatJid = normalizeChatJid(msg.thread_id);
            const senderJid = normalizeChatJid(resolveRealFacebookId(internalId, service));
            try {
              const result = await service.sendE2EEReaction(chatJid, params.messageId, senderJid, params.emoji);
              if (result.success) success = true;
            } catch {}
          } else {
            // Group message (non-numeric thread ID) â€” try bridge sendReaction
            try {
              const result = await service.sendBridgeReaction(msg.thread_id, params.messageId, params.emoji);
              if (result.success) success = true;
            } catch {}
          }
        }
      }

      // Fallback to GraphQL mutation if bridge didn't succeed
      if (!success) {
        const result = await service.addReaction(params.messageId, params.emoji, params.action);
        if (result.success) success = true;
      }

      // Save to local DB for persistence (even if Facebook API fails, keep local state)
      if (params.emoji) {
        // Build reactions payload in old format { userId: emoji }
        const fbId = resolveRealFacebookId(internalId, service);
        const reactionsPayload: Record<string, string> = {};
        reactionsPayload[fbId || internalId] = params.emoji;
        DatabaseService.getInstance().updateFBMessageReaction(params.messageId, JSON.stringify(reactionsPayload));
      }

      return { success };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Chá»‰nh sá»­a ná»™i dung tin nháº¯n Ä‘Ã£ gá»­i (I1)
   */
  ipcMain.handle('fb:editMessage', async (_event, params: {
    accountId: string; messageId: string; text: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      return await service.editMessage(params.messageId, params.text);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Láº¥y danh sÃ¡ch threads
   */
  ipcMain.handle('fb:getThreads', async (_event, params: {
    accountId: string; forceRefresh?: boolean;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      // Láº¥y tá»« DB trÆ°á»›c (cache)
      const cached = DatabaseService.getInstance().getFBThreads(internalId);

      if (!params.forceRefresh && cached.length > 0) {
        return { success: true, threads: cached };
      }

      // Refresh tá»« Facebook API
      const service = FacebookConnectionManager.get(internalId);
      if (service && service.isConnected()) {
        const threads = await service.getThreadList();
        DatabaseService.getInstance().saveFBThreads(internalId, threads);
        const updated = DatabaseService.getInstance().getFBThreads(internalId);
        return { success: true, threads: updated };
      }

      return { success: true, threads: cached };
    } catch (err: any) {
      Logger.error(`[facebookIpc] fb:getThreads error: ${err.message}`);
      return { success: false, threads: [], error: err.message };
    }
  });

  /**
   * Láº¥y messages tá»« DB local
   */
  ipcMain.handle('fb:getMessages', async (_event, params: {
    accountId: string; threadId: string; limit?: number; offset?: number;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const messages = DatabaseService.getInstance().getFBMessages(
        internalId, params.threadId, params.limit || 50, params.offset || 0
      );
      return { success: true, messages };
    } catch (err: any) {
      return { success: false, messages: [], error: err.message };
    }
  });

  /**
   * ÄÃ¡nh dáº¥u Ä‘Ã£ Ä‘á»c (C5: gá»­i lÃªn Facebook server qua bridge)
   */
  ipcMain.handle('fb:markAsRead', async (_event, params: {
    accountId: string; threadId: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      DatabaseService.getInstance().markFBThreadAsRead(internalId, params.threadId);

      // C5: Also send read receipt to Facebook server
      const service = FacebookConnectionManager.get(internalId);
      if (service) {
        service.markReadOnServer(params.threadId).catch(() => {});
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Äá»•i tÃªn nhÃ³m
   */
  ipcMain.handle('fb:changeThreadName', async (_event, params: {
    accountId: string; threadId: string; name: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      const ok = await service.changeThreadName(params.threadId, params.name);
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Äá»•i emoji nhÃ³m
   */
  ipcMain.handle('fb:changeThreadEmoji', async (_event, params: {
    accountId: string; threadId: string; emoji: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      const ok = await service.changeThreadEmoji(params.threadId, params.emoji);
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Äá»•i nickname thÃ nh viÃªn
   */
  ipcMain.handle('fb:changeNickname', async (_event, params: {
    accountId: string; threadId: string; userId: string; nickname: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      const ok = await service.changeNickname(params.threadId, params.userId, params.nickname);
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * ÄÄƒng nháº­p báº±ng username/password
   */
  ipcMain.handle('fb:loginWithCredentials', async (_event, params: {
    username: string; password: string; twoFASecret?: string;
  }) => {
    try {
      const result = await loginWithCredentials(params.username, params.password, params.twoFASecret);
      return { success: !!result.success, result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // â”€â”€â”€ E2EE Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Gá»­i tin nháº¯n E2EE (1:1 encrypted)
   */
  ipcMain.handle('fb:sendE2EEMessage', async (_event, params: {
    accountId: string; chatJid: string; text: string; replyToId?: string; replyToSenderJid?: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };

      const sender = service.getE2EESender();
      if (!sender) return { success: false, error: 'E2EE bridge not connected' };

      const result = await sender.send(
        params.chatJid,
        params.text,
        params.replyToId || '',
        params.replyToSenderJid || '',
      );

      // Save sent message to DB
      if (result.success && result.messageId) {
        try {
          DatabaseService.getInstance().saveFBMessage({
            id: result.messageId,
            account_id: internalId,
            thread_id: params.chatJid, // Use chatJid as thread_id for 1:1 E2EE
            sender_id: resolveRealFacebookId(internalId, service),
            body: params.text,
            timestamp: result.timestamp || Date.now(),
            type: 'text',
            is_self: 1,
            is_unsent: 0,
            ...(params.replyToId ? { reply_to_id: params.replyToId } : {}),
          });
        } catch (dbErr: any) {
          Logger.warn(`[facebookIpc] fb:sendE2EEMessage DB save error: ${dbErr.message}`);
        }
      }

      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Kiá»ƒm tra tráº¡ng thÃ¡i E2EE bridge
   */
  ipcMain.handle('fb:getE2EEStatus', async (_event, params: {
    accountId: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = FacebookConnectionManager.get(internalId);
      if (!service) return { success: true, status: 'disconnected', available: false };

      return {
        success: true,
        status: service.getE2EEStatus(),
        connected: service.isE2EEConnected(),
        available: service.isE2EEAvailable(),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Báº­t/táº¯t E2EE bridge thá»§ cÃ´ng
   */
  ipcMain.handle('fb:toggleE2EE', async (_event, params: {
    accountId: string; enable: boolean;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };

      if (params.enable) {
        // E2EE is auto-started during connect â€” manual reconnect náº¿u cáº§n
        await service.disconnect();
        await service.connect();
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Gá»­i typing indicator (C6)
   */
  ipcMain.handle('fb:sendTyping', async (_event, params: {
    accountId: string; threadId: string; isTyping: boolean; isGroup?: boolean;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };

      await service.sendTyping(params.threadId, params.isTyping, params.isGroup || false);
      return { success: true };
    } catch (err: any) {
      // Typing is best-effort â€” no error returned
      return { success: true };
    }
  });

  /**
   * Gá»­i seen/delivered receipt (C5)
   */
  ipcMain.handle('fb:sendSeen', async (_event, params: {
    accountId: string; threadId: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };

      await service.markReadOnServer(params.threadId);
      return { success: true };
    } catch (err: any) {
      return { success: true };
    }
  });

  /**
   * Chuyá»ƒn tiáº¿p tin nháº¯n (I2)
   */
  ipcMain.handle('fb:forwardMessage', async (_event, params: {
    accountId: string; messageId: string; targetThreadId: string; isGroup?: boolean;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      return await service.forwardMessage(params.messageId, params.targetThreadId, params.isGroup || false);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Ghim tin nháº¯n (I3)
   */
  ipcMain.handle('fb:pinMessage', async (_event, params: {
    accountId: string; messageId: string; threadId: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      return await service.pinMessage(params.messageId, params.threadId);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Bá» ghim tin nháº¯n (I3)
   */
  ipcMain.handle('fb:unpinMessage', async (_event, params: {
    accountId: string; messageId: string; threadId: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      return await service.unpinMessage(params.messageId, params.threadId);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Táº¡o poll (I6)
   */
  ipcMain.handle('fb:createPoll', async (_event, params: {
    accountId: string; threadId: string; question: string; options: string[];
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      return await service.createPoll(params.threadId, params.question, params.options);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Bá» phiáº¿u poll (I6)
   */
  ipcMain.handle('fb:votePoll', async (_event, params: {
    accountId: string; pollId: string; optionIds: string[];
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      return await service.votePoll(params.pollId, params.optionIds);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Fetch tin nháº¯n lá»‹ch sá»­ tá»« Facebook API (C7)
   * KhÃ¡c vá»›i fb:getMessages (Ä‘á»c tá»« DB local), cÃ¡i nÃ y gá»i API GraphQL
   * Tá»± Ä‘á»™ng lÆ°u tin nháº¯n fetch Ä‘Æ°á»£c vÃ o DB Ä‘á»ƒ dÃ¹ng offline.
   */
  ipcMain.handle('fb:fetchThreadMessages', async (_event, params: {
    accountId: string; threadId: string; limit?: number; beforeCursor?: string | null;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      const result = await service.fetchThreadMessages(params.threadId, params.limit, params.beforeCursor);
      // LÆ°u tin nháº¯n vÃ o DB Ä‘á»ƒ dÃ¹ng offline
      if (result.success && result.messages?.length) {
        const db = DatabaseService.getInstance();
        for (const msg of result.messages) {
          db.saveFBMessage({
            id: msg.id,
            account_id: internalId,
            thread_id: params.threadId,
            sender_id: msg.senderId,
            sender_name: msg.senderName || '',
            body: msg.body || null,
            timestamp: msg.timestampMs,
            type: msg.attachments?.length ? 'file' : 'text',
            attachments: msg.attachments?.length ? JSON.stringify(msg.attachments) : '[]',
            reply_to_id: msg.replyToMessageId || '',
            is_self: String(msg.senderId) === internalId ? 1 : 0,
            is_unsent: msg.isUnsent ? 1 : 0,
            reactions: msg.reactions?.length ? JSON.stringify(msg.reactions) : '{}',
          });
        }
        Logger.log(`[fb:fetchThreadMessages] Saved ${result.messages.length} messages to DB`);
      }
      return result;
    } catch (err: any) {
      return { success: false, messages: [], error: err.message };
    }
  });

  // â”€â”€â”€ Scan Data Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * QuÃ©t thÃ nh viÃªn nhÃ³m Facebook
   */
  ipcMain.handle('fb:scanGroupMembers', async (_event, params: {
    accountId: string; groupId: string; cursor?: string | null;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
      const service = FacebookScanService.getInstance();
      const result = await service.scanGroupMembers(internalId, params.groupId, params.cursor);
      return result;
    } catch (err: any) {
      return { success: false, items: [], pageInfo: { endCursor: null, hasNextPage: false }, error: err.message };
    }
  });

  /**
   * QuÃ©t nhÃ³m theo tá»« khÃ³a
   */
  ipcMain.handle('fb:scanGroupKeyword', async (_event, params: {
    accountId: string; keyword: string; cursor?: string | null; filters?: string[]; bsid?: string; tsid?: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
      const service = FacebookScanService.getInstance();
      const result = await service.scanSearchComet(internalId, { keyword: params.keyword, type: 'group', cursor: params.cursor, filters: params.filters, bsid: params.bsid, tsid: params.tsid });
      return result;
    } catch (err: any) {
      return { success: false, items: [], pageInfo: { endCursor: null, hasNextPage: false }, error: err.message };
    }
  });

  /**
   * QuÃ©t fanpage theo tá»« khÃ³a
   */
  ipcMain.handle('fb:scanFanpageKeyword', async (_event, params: {
    accountId: string; keyword: string; cursor?: string | null; filters?: string[]; bsid?: string; tsid?: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
      const service = FacebookScanService.getInstance();
      const result = await service.scanSearchComet(internalId, { keyword: params.keyword, type: 'page', cursor: params.cursor, filters: params.filters, bsid: params.bsid, tsid: params.tsid });
      return result;
    } catch (err: any) {
      return { success: false, items: [], pageInfo: { endCursor: null, hasNextPage: false }, error: err.message };
    }
  });

  /**
   * QuÃ©t bÃ¬nh luáº­n bÃ i viáº¿t
   */
  ipcMain.handle('fb:scanPostComments', async (_event, params: {
    accountId: string; postId: string; cursor?: string | null;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
      const service = FacebookScanService.getInstance();
      const result = await service.scanPostComments(internalId, params.postId, params.cursor);
      return result;
    } catch (err: any) {
      return { success: false, items: [], pageInfo: { endCursor: null, hasNextPage: false }, error: err.message };
    }
  });

  /**
   * QuÃ©t bÃ i viáº¿t theo tá»« khÃ³a
   */
  ipcMain.handle('fb:scanPostKeyword', async (_event, params: {
    accountId: string; keyword: string; cursor?: string | null; filters?: string[]; bsid?: string; tsid?: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
      const service = FacebookScanService.getInstance();
      const result = await service.scanSearchComet(internalId, { keyword: params.keyword, type: 'post', cursor: params.cursor, filters: params.filters, bsid: params.bsid, tsid: params.tsid });
      return result;
    } catch (err: any) {
      return { success: false, items: [], pageInfo: { endCursor: null, hasNextPage: false }, error: err.message };
    }
  });

  /**
   * QuÃ©t bÃ i Ä‘Äƒng tá»« timeline profile/fanpage/group
   */
  ipcMain.handle('fb:scanPostTimeline', async (_event, params: {
    accountId: string; sourceId: string; sourceType: 'profile' | 'fanpage' | 'group'; cursor?: string | null;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
      const service = FacebookScanService.getInstance();
      const result = await service.scanPostTimeline(internalId, params.sourceId, params.sourceType, params.cursor);
      return result;
    } catch (err: any) {
      return { success: false, items: [], pageInfo: { endCursor: null, hasNextPage: false }, error: err.message };
    }
  });

  /**
   * Reset scan cache (clear context + docId cache)
   */
  // â”€â”€â”€ Batch Scan Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * QuÃ©t thÃ nh viÃªn nhiá»u nhÃ³m cÃ¹ng lÃºc (batch)
   */
  ipcMain.handle('fb:scanGroupMembersBatch', async (_event, params: {
    accountId: string; groupIds: string[]; threadCount?: number;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
      const service = FacebookScanService.getInstance();
      const result = await service.scanGroupMembersBatch(internalId, params.groupIds, params.threadCount || 5);
      return result;
    } catch (err: any) {
      return { success: false, items: [], errors: [err.message], error: err.message };
    }
  });

  /**
   * QuÃ©t bÃ¬nh luáº­n nhiá»u bÃ i viáº¿t cÃ¹ng lÃºc (batch)
   */
  ipcMain.handle('fb:scanPostCommentsBatch', async (_event, params: {
    accountId: string; postIds: string[]; threadCount?: number;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
      const service = FacebookScanService.getInstance();
      const result = await service.scanPostCommentsBatch(internalId, params.postIds, params.threadCount || 5);
      return result;
    } catch (err: any) {
      return { success: false, items: [], errors: [err.message], error: err.message };
    }
  });

  // â”€â”€â”€ Scan Log Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * LÆ°u 1 entry scan history
   */
  ipcMain.handle('fb:saveScanLog', async (_event, params: {
    accountId: string; tabId?: string; tabName?: string; scanType: string; input: string;
    status: 'success' | 'error'; itemsCount?: number;
    error?: string; requestPayload?: string;
    responsePreview?: string; requestHeaders?: string; responseHeaders?: string;
    docId?: string; threadCount?: number;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const { FacebookScanLogService } = require('../../src/services/facebook/FacebookScanLogService');
      FacebookScanLogService.init();
      const id = FacebookScanLogService.save({
        accountId: internalId,
        tabId: params.tabId || '',
        tabName: params.tabName || '',
        scanType: params.scanType,
        input: params.input,
        status: params.status,
        itemsCount: params.itemsCount || 0,
        error: params.error || '',
        requestPayload: params.requestPayload || '{}',
        responsePreview: params.responsePreview || '',
        requestHeaders: params.requestHeaders || '',
        responseHeaders: params.responseHeaders || '',
        docId: params.docId || '',
        threadCount: params.threadCount || 1,
        createdAt: Date.now(),
      });
      return { success: true, id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Láº¥y lá»‹ch sá»­ scan
   */
  ipcMain.handle('fb:getScanLogs', async (_event, params: {
    accountId: string; tabId?: string; limit?: number; offset?: number;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const { FacebookScanLogService } = require('../../src/services/facebook/FacebookScanLogService');
      const result = FacebookScanLogService.getList(internalId, params.tabId, params.limit || 50, params.offset || 0);
      return { success: true, ...result };
    } catch (err: any) {
      return { success: false, logs: [], total: 0, error: err.message };
    }
  });

  ipcMain.handle('fb:scanResetCache', async () => {
    try {
      const { FacebookScanService } = require('../../src/services/facebook/FacebookScanService');
      const service = FacebookScanService.getInstance();
      service.clearCache();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // â”€â”€â”€ Scan Tab Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * LÆ°u/cáº­p nháº­t tab
   */
  ipcMain.handle('fb:scanSaveTab', async (_event, params: {
    id: string; accountId: string; name: string; scanType: string;
    config: string; status?: string; itemsCount?: number;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
      FacebookScanTabService.init();
      // Preserve original created_at if tab already exists
      const existing = FacebookScanTabService.getTab(params.id);
      const ok = FacebookScanTabService.saveTab({
        id: params.id,
        accountId: internalId,
        name: params.name,
        scanType: params.scanType,
        config: params.config,
        status: (params.status as any) || 'active',
        itemsCount: params.itemsCount || 0,
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
      });
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Láº¥y danh sÃ¡ch tabs
   */
  ipcMain.handle('fb:scanGetTabs', async (_event, params: {
    accountId: string; status?: string; limit?: number; offset?: number;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
      const result = FacebookScanTabService.getTabs(internalId, params.status as any, params.limit, params.offset);
      return { success: true, ...result };
    } catch (err: any) {
      return { success: false, tabs: [], total: 0, error: err.message };
    }
  });

  /**
   * Láº¥y 1 tab
   */
  ipcMain.handle('fb:scanGetTab', async (_event, params: { id: string }) => {
    try {
      const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
      const tab = FacebookScanTabService.getTab(params.id);
      return { success: !!tab, tab };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Cáº­p nháº­t tráº¡ng thÃ¡i tab (active/archived/deleted)
   */
  ipcMain.handle('fb:scanUpdateTabStatus', async (_event, params: { id: string; status: string }) => {
    try {
      const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
      const ok = FacebookScanTabService.updateTabStatus(params.id, params.status as any);
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * XoÃ¡ háº³n tab + data + request logs
   */
  ipcMain.handle('fb:scanDeleteTab', async (_event, params: { id: string }) => {
    try {
      const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
      const ok = FacebookScanTabService.deleteTab(params.id);
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Cáº­p nháº­t updated_at cho tab (Ä‘áº©y lÃªn Ä‘áº§u danh sÃ¡ch)
   */
  ipcMain.handle('fb:scanTouchTab', async (_event, params: { id: string }) => {
    try {
      const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
      const ok = FacebookScanTabService.touchTab(params.id);
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * LÆ°u data cho tab
   */
  ipcMain.handle('fb:scanSaveTabData', async (_event, params: {
    tabId: string; items: any[]; pageInfo: { endCursor: string | null; hasNextPage: boolean };
  }) => {
    try {
      const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
      const id = FacebookScanTabService.saveTabData(params.tabId, params.items, params.pageInfo);
      return { success: true, id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Láº¥y data Ä‘Ã£ lÆ°u cho tab (items + pageInfo tá»« láº§n scan gáº§n nháº¥t)
   */
  ipcMain.handle('fb:scanGetTabData', async (_event, params: { tabId: string }) => {
    try {
      const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
      const rows = FacebookScanTabService.getTabData(params.tabId, 1);
      if (rows.length > 0) {
        const latest = rows[0];
        return {
          success: true,
          items: JSON.parse(latest.items || '[]'),
          pageInfo: JSON.parse(latest.page_info || '{}'),
        };
      }
      return { success: true, items: [], pageInfo: { endCursor: null, hasNextPage: false } };
    } catch (err: any) {
      return { success: false, items: [], pageInfo: { endCursor: null, hasNextPage: false }, error: err.message };
    }
  });

  /**
   * LÆ°u request log cho tab
   */
  ipcMain.handle('fb:scanSaveRequestLog', async (_event, params: {
    tabId: string; requestPayload: string; responsePreview: string;
    requestHeaders?: string; responseHeaders?: string;
    status: string; error?: string; itemsCount?: number;
  }) => {
    try {
      const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
      const id = FacebookScanTabService.saveRequestLog(params.tabId, {
        requestPayload: params.requestPayload,
        responsePreview: params.responsePreview,
        status: params.status as any,
        error: params.error,
        itemsCount: params.itemsCount,
      });
      return { success: true, id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Láº¥y request logs cá»§a tab
   */
  ipcMain.handle('fb:scanGetRequestLogs', async (_event, params: { tabId: string; limit?: number; offset?: number }) => {
    try {
      const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
      const result = FacebookScanTabService.getRequestLogs(params.tabId, params.limit, params.offset);
      return { success: true, ...result };
    } catch (err: any) {
      return { success: false, logs: [], total: 0, error: err.message };
    }
  });

  /**
   * Thá»‘ng kÃª scan
   */
  ipcMain.handle('fb:scanGetStats', async (_event, params: { accountId: string }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const { FacebookScanTabService } = require('../../src/services/facebook/FacebookScanTabService');
      const stats = FacebookScanTabService.getStats(internalId);
      return { success: true, ...stats };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  Logger.log('[facebookIpc] All handlers registered');

  /**
   * Block ngÆ°á»i dÃ¹ng (N4)
   */
  ipcMain.handle('fb:blockUser', async (_event, params: {
  accountId: string; userId: string;
}) => {
  try {
    const internalId = resolveInternalId(params.accountId);
    const service = await getFBServiceOrReconnect(internalId);
    if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
    return await service.blockUser(params.userId);
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

/**
 * Unblock ngÆ°á»i dÃ¹ng (N4)
 */
  ipcMain.handle('fb:unblockUser', async (_event, params: {
    accountId: string; userId: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      return await service.unblockUser(params.userId);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
  
  /**
   * Äá»•i theme há»™i thoáº¡i (N1)
   */
  ipcMain.handle('fb:changeThreadTheme', async (_event, params: {
    accountId: string; threadId: string; theme: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      return await service.changeThreadTheme(params.threadId, params.theme);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
  
  /**
   * Táº¡o Messenger Note (N2)
   */
  ipcMain.handle('fb:createNote', async (_event, params: {
    accountId: string; text: string; backgroundColor?: string; textColor?: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      return await service.createNote(params.text, params.backgroundColor, params.textColor);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
  
  // â”€â”€â”€ N3: Group Admin Operations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  
  /**
   * ThÃªm admin nhÃ³m (N3)
   */
  ipcMain.handle('fb:addGroupAdmin', async (_event, params: {
    accountId: string; threadId: string; userId: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      return await service.addGroupAdmin(params.threadId, params.userId);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
  
  /**
   * XÃ³a admin nhÃ³m (N3)
   */
  ipcMain.handle('fb:removeGroupAdmin', async (_event, params: {
    accountId: string; threadId: string; userId: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      return await service.removeGroupAdmin(params.threadId, params.userId);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
  
  /**
   * Báº­t/táº¯t duyá»‡t thÃ nh viÃªn (N3)
   */
  ipcMain.handle('fb:changeApprovalMode', async (_event, params: {
    accountId: string; threadId: string; approved: boolean;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      return await service.changeApprovalMode(params.threadId, params.approved);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
  
  /**
   * Duyá»‡t/tá»« chá»‘i thÃ nh viÃªn (N3)
   */
  ipcMain.handle('fb:approvePendingMember', async (_event, params: {
    accountId: string; threadId: string; userId: string; approve: boolean;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      return await service.approvePendingMember(params.threadId, params.userId, params.approve);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
  
  /**
   * Láº¥y link má»i nhÃ³m (N3)
   */
  ipcMain.handle('fb:getGroupLink', async (_event, params: {
    accountId: string; threadId: string;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      return await service.getGroupLink(params.threadId);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
  
  /**
   * Báº­t/táº¯t link má»i nhÃ³m (N3)
   */
  ipcMain.handle('fb:setGroupLink', async (_event, params: {
    accountId: string; threadId: string; enable: boolean;
  }) => {
    try {
      const internalId = resolveInternalId(params.accountId);
      const service = await getFBServiceOrReconnect(internalId);
      if (!service) return { success: false, error: 'TÃ i khoáº£n chÆ°a káº¿t ná»‘i. Vui lÃ²ng káº¿t ná»‘i láº¡i Facebook.' };
      return await service.setGroupLink(params.threadId, params.enable);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
    });
}

/**
 * Auto-reconnect táº¥t cáº£ FB accounts khi app khá»Ÿi Ä‘á»™ng.
 * - Bá» qua account Ä‘Ã£ connected
 * - Test cookie health trÆ°á»›c khi connect
 * - Náº¿u cookie expired â†’ bá» qua (khÃ´ng thá»­)
 */
export async function reconnectAllFBAccounts(): Promise<void> {
  try {
    const accounts = DatabaseService.getInstance().getFBAccounts();
    Logger.log(`[facebookIpc] reconnectAllFBAccounts: ${accounts.length} FB accounts found`);
    for (const acc of accounts) {
      try {
        // Bá» qua account Ä‘Ã£ connected
        const existing = FacebookConnectionManager.get(acc.id);
        if (existing && existing.isConnected()) {
          Logger.log(`[facebookIpc] reconnectAllFBAccounts ${acc.id}: already connected, skipping`);
          continue;
        }

        const cookie = secureGet(fbCookieKey(acc.id)) || acc.cookie_encrypted;
        if (!cookie) {
          Logger.warn(`[facebookIpc] reconnectAllFBAccounts ${acc.id}: no cookie found, skipping`);
          continue;
        }

        // Test cookie health trÆ°á»›c khi connect
        try {
          const { checkCookieAlive } = require('../../src/services/facebook/FacebookSession');
          const alive = await checkCookieAlive(cookie);
          if (!alive) {
            Logger.warn(`[facebookIpc] reconnectAllFBAccounts ${acc.id}: cookie expired, skipping`);
            continue;
          }
        } catch (healthErr: any) {
          Logger.warn(`[facebookIpc] reconnectAllFBAccounts ${acc.id}: health check failed: ${healthErr.message}, trying anyway`);
        }

        // Äá»c proxy_id tá»« unified accounts table
        let proxyId: number | null | undefined;
        try {
          const accRow = DatabaseService.getInstance().queryOne<any>('SELECT proxy_id FROM accounts WHERE zalo_id = ?', [acc.facebook_id || acc.id]);
          proxyId = accRow?.proxy_id ?? null;
        } catch { proxyId = null; }

        const service = await FacebookConnectionManager.getOrCreate(acc.id, cookie, proxyId);
        // Reset retry count sau khi connect thÃ nh cÃ´ng
        if (service.isConnected()) {
          service.resetListenerRetryCount?.();
        }
        Logger.log(`[facebookIpc] reconnectAllFBAccounts ${acc.id}: connected successfully`);
      } catch (err: any) {
        Logger.warn(`[facebookIpc] reconnectAllFBAccounts ${acc.id}: ${err.message}`);
      }
    }
  } catch (err: any) {
    Logger.warn(`[facebookIpc] reconnectAllFBAccounts error: ${err.message}`);
  }
}

