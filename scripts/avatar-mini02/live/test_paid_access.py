import base64, hashlib, hmac, json, time, unittest
from paid_access import PaidAccess
class TicketTests(unittest.TestCase):
    secret='a-long-test-secret-with-at-least-32-characters'
    def ticket(self, **changes):
        now=int(time.time()); data=dict(sub='admin',aud='avatar-mini02',jti='one',iat=now,exp=now+60);data.update(changes)
        body=base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip('=')
        signature=base64.urlsafe_b64encode(hmac.new(self.secret.encode(),body.encode(),hashlib.sha256).digest()).decode().rstrip('=')
        return body+'.'+signature
    def test_valid_session_and_replay(self):
        access=PaidAccess(self.secret); ticket=self.ticket(); session=access.consume(ticket)
        self.assertGreater(access.remaining(session),599)
        with self.assertRaises(ValueError):access.consume(ticket)
    def test_invalid(self):
        for ticket in [self.ticket(exp=0),self.ticket(aud='wrong'),self.ticket()+'x','garbage',self.ticket(iat=time.time()+100)]:
            with self.assertRaises(ValueError):PaidAccess(self.secret).consume(ticket)
        self.assertEqual(PaidAccess(self.secret).remaining('unknown'),0)
    def test_vidu_session_is_bound_to_its_audience(self):
        access=PaidAccess(self.secret)
        session=access.consume(self.ticket(aud='vidu-s2'))
        self.assertEqual(access.audience(session),'vidu-s2')
        self.assertIsNone(access.audience('unknown'))
if __name__=='__main__':unittest.main()
