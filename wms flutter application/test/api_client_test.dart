import 'package:flutter_test/flutter_test.dart';
import 'package:wms_mobile/core/api_client.dart';

void main() {
  group('ApiClient', () {
    test('ApiException exposes the server message', () {
      final error = ApiException(409, 'Conflict');

      expect(error.statusCode, 409);
      expect(error.message, 'Conflict');
      expect(error.toString(), 'Conflict');
    });

    test('constructs with a base URL and optional token', () {
      final client = ApiClient(
        baseUrl: 'https://wms.kynox.io',
        token: 'test-token',
      );

      expect(client.baseUrl, 'https://wms.kynox.io');
      expect(client.token, 'test-token');
    });
  });
}
