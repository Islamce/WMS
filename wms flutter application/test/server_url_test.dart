import 'package:flutter_test/flutter_test.dart';
import 'package:wms_mobile/core/server_url.dart';

void main() {
  group('ServerUrl.validationError', () {
    test('accepts the production server', () {
      expect(ServerUrl.validationError(ServerUrl.defaultUrl), isNull);
    });

    test('accepts another https host, which is the whole point of the setting', () {
      expect(ServerUrl.validationError('https://uat.kynox.io'), isNull);
      expect(ServerUrl.validationError('https://uat.kynox.io:8443'), isNull);
    });

    test('rejects an empty or partial address with something a person can act on', () {
      expect(ServerUrl.validationError(''), 'Enter a server address.');
      expect(ServerUrl.validationError('   '), 'Enter a server address.');
      expect(ServerUrl.validationError('wms.kynox.io'),
          'Enter the full address, starting with https://');
    });

    test('rejects a scheme that is not http or https', () {
      expect(ServerUrl.validationError('ftp://wms.kynox.io'),
          'The address must start with https:// or http://');
    });

    test('rejects an address carrying a query or fragment', () {
      expect(ServerUrl.validationError('https://wms.kynox.io?a=1'),
          'Enter the server address only, with nothing after ? or #');
      expect(ServerUrl.validationError('https://wms.kynox.io#x'),
          'Enter the server address only, with nothing after ? or #');
    });

    // Credentials go over the first request, so plain http off the local
    // network would put a password on the wire in clear.
    test('refuses plain http to a public host', () {
      expect(ServerUrl.validationError('http://wms.kynox.io'), isNotNull);
      expect(ServerUrl.validationError('http://example.com'), isNotNull);
    });

    test('but allows plain http on the network the phone is on, which is how UAT runs', () {
      expect(ServerUrl.validationError('http://localhost:3000'), isNull);
      expect(ServerUrl.validationError('http://127.0.0.1:3000'), isNull);
      expect(ServerUrl.validationError('http://192.168.1.50:3000'), isNull);
      expect(ServerUrl.validationError('http://10.0.0.8:3000'), isNull);
      expect(ServerUrl.validationError('http://172.16.4.2:3000'), isNull);
      expect(ServerUrl.validationError('http://site-laptop.local:3000'), isNull);
    });

    test('a public address that merely looks private is still refused', () {
      // 172.32 is outside the private 172.16-31 block, and 11.x is public.
      expect(ServerUrl.validationError('http://172.32.0.1:3000'), isNotNull);
      expect(ServerUrl.validationError('http://11.0.0.1:3000'), isNotNull);
      expect(ServerUrl.validationError('http://999.1.1.1:3000'), isNotNull);
    });
  });

  group('ServerUrl.normalize', () {
    test('two spellings of the production server are one server', () {
      // If these compared unequal the "TEST SERVER" banner would fire while
      // the app was on production, which teaches people to ignore it.
      expect(ServerUrl.normalize('https://wms.kynox.io/'), ServerUrl.defaultUrl);
      expect(ServerUrl.normalize('  https://wms.kynox.io  '), ServerUrl.defaultUrl);
      expect(ServerUrl.normalize('HTTPS://WMS.KYNOX.IO'), ServerUrl.defaultUrl);
      expect(ServerUrl.normalize('https://wms.kynox.io:443'), ServerUrl.defaultUrl);
      expect(ServerUrl.isDefault('https://wms.kynox.io///'), isTrue);
    });

    test('keeps a non-default port and a sub-path', () {
      expect(ServerUrl.normalize('http://192.168.1.50:3000/'), 'http://192.168.1.50:3000');
      expect(ServerUrl.normalize('https://host.example/wms/'), 'https://host.example/wms');
    });

    test('a different server does not read as the default one', () {
      expect(ServerUrl.isDefault('https://uat.kynox.io'), isFalse);
      expect(ServerUrl.isDefault('http://192.168.1.50:3000'), isFalse);
    });
  });

  group('ServerUrl.hostOf', () {
    test('gives the bare host for a banner', () {
      expect(ServerUrl.hostOf('https://wms.kynox.io'), 'wms.kynox.io');
      expect(ServerUrl.hostOf('http://192.168.1.50:3000'), '192.168.1.50');
    });

    test('falls back to the raw value rather than showing nothing', () {
      expect(ServerUrl.hostOf('not a url'), 'not a url');
    });
  });
}
