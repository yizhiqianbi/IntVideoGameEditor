"""One-use commercial-site launch tickets; no GPU or Supabase keys in browser."""
import base64, hashlib, hmac, json, secrets, time

class PaidAccess:
    def __init__(self, secret):
        self.secret = secret
        self.used = {}
        self.sessions = {}

    def consume(self, ticket, now=None):
        now = time.time() if now is None else now
        if not self.secret or len(ticket) > 4096:
            raise ValueError('Invalid ticket')
        try:
            payload, signature = ticket.split('.')
            expected = base64.urlsafe_b64encode(hmac.new(self.secret.encode(), payload.encode(), hashlib.sha256).digest()).decode().rstrip('=')
            if not hmac.compare_digest(signature, expected): raise ValueError()
            data = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
            if data['aud'] not in ('avatar-mini02', 'vidu-s2') or not isinstance(data['sub'], str) or not data['sub']: raise ValueError()
            if not now < data['exp'] <= now + 65 or not now - 65 <= data['iat'] <= now + 5: raise ValueError()
            self.used = {k:v for k,v in self.used.items() if v > now}
            self.sessions = {k:v for k,v in self.sessions.items() if v['exp'] > now}
            if not isinstance(data['jti'], str) or not data['jti'] or data['jti'] in self.used: raise ValueError()
            if len(self.sessions) >= 1000: raise ValueError()
            self.used[data['jti']] = data['exp']
            token = secrets.token_urlsafe(32)
            self.sessions[token] = {'sub': data['sub'], 'aud': data['aud'], 'exp': now + 600}
            return token
        except (KeyError, TypeError, ValueError, UnicodeError) as exc:
            raise ValueError('Invalid or expired ticket') from exc

    def remaining(self, token):
        return max(0, self.sessions.get(token, {}).get('exp', 0) - time.time())

    def audience(self, token):
        return self.sessions.get(token, {}).get('aud') if self.remaining(token) > 0 else None
