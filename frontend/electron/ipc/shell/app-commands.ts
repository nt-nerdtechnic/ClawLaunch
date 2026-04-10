import https from 'node:https';
import { app } from 'electron';
import type { CommandResult } from './types.js';

export async function handleAppCommands(fullCommand: string): Promise<CommandResult | null> {
  if (fullCommand === 'app:get-version') {
    return { code: 0, stdout: app.getVersion(), stderr: '', exitCode: 0 };
  }

  if (fullCommand === 'app:check-update') {
    try {
      const current = app.getVersion();
      const releases = await new Promise<unknown[]>((resolve, reject) => {
        const req = https.get(
          'https://api.github.com/repos/nt-nerdtechnic/ClawLaunch/releases?per_page=1',
          { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'NT-ClawLaunch' } },
          (res) => {
            if ((res.statusCode ?? 0) >= 400) {
              reject(new Error(`GitHub API returned ${res.statusCode}`));
              return;
            }
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
              try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON response')); }
            });
          },
        );
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out')); });
      });
      if (!releases.length) {
        return { code: 0, stdout: JSON.stringify({ current, latest: '', htmlUrl: '', upToDate: true, noReleases: true }), stderr: '', exitCode: 0 };
      }
      const rel0 = releases[0] as Record<string, unknown>;
      const latest = String(rel0.tag_name || '').replace(/^v/, '');
      const htmlUrl = String(rel0.html_url || '');
      const changelog = String(rel0.body || '');
      const publishedAt = String(rel0.published_at || '');
      const parseSemver = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
      const [lMaj, lMin, lPat] = parseSemver(latest);
      const [cMaj, cMin, cPat] = parseSemver(current);
      const isNewer = !!latest && (
        lMaj > cMaj ||
        (lMaj === cMaj && lMin > cMin) ||
        (lMaj === cMaj && lMin === cMin && lPat > cPat)
      );
      return { code: 0, stdout: JSON.stringify({ current, latest, htmlUrl, changelog, publishedAt, upToDate: !isNewer }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'update check failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'app:quit') {
    app.quit();
    return { code: 0, stdout: '', stderr: '', exitCode: 0 };
  }

  if (fullCommand === 'app:relaunch') {
    app.relaunch();
    app.exit(0);
    return { code: 0, stdout: '', stderr: '', exitCode: 0 };
  }

  return null;
}
