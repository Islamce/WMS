import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

/// Thrown for any non-2xx response; [message] is the server's error text.
class ApiException implements Exception {
  final int statusCode;
  final String message;
  ApiException(this.statusCode, this.message);
  @override
  String toString() => message;
}

/// Thin JSON wrapper around the WMS REST API. The base URL and bearer token
/// are injected by [Session] so the same endpoints as the web app are used.
class ApiClient {
  ApiClient({required this.baseUrl, this.token});

  /// e.g. https://my-codespace-3000.app.github.dev  (no trailing slash)
  final String baseUrl;
  final String? token;

  Uri _uri(String path) {
    final b = baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl;
    return Uri.parse('$b$path');
  }

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (token != null && token!.isNotEmpty) 'Authorization': 'Bearer $token',
      };

  Future<dynamic> get(String path) => _send('GET', path);
  Future<dynamic> post(String path, [Object? body]) => _send('POST', path, body);
  Future<dynamic> put(String path, [Object? body]) => _send('PUT', path, body);
  Future<dynamic> patch(String path, [Object? body]) => _send('PATCH', path, body);
  Future<dynamic> delete(String path, [Object? body]) => _send('DELETE', path, body);

  /// Downloads an authenticated non-JSON response, such as a protected QR PDF.
  Future<Uint8List> downloadBytes(String path, {String? expectedContentType}) async {
    late http.Response res;
    try {
      res = await http.get(
        _uri(path),
        headers: {
          if (token != null && token!.isNotEmpty) 'Authorization': 'Bearer $token',
          'Accept': expectedContentType ?? 'application/octet-stream',
        },
      ).timeout(const Duration(seconds: 30));
    } catch (e) {
      throw ApiException(0, 'Cannot reach the server. Check the server URL and network connection.\n($e)');
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      var message = 'Download failed (${res.statusCode}).';
      try {
        final decoded = jsonDecode(res.body);
        if (decoded is Map && decoded['error'] != null) message = decoded['error'].toString();
      } catch (_) {
        // Binary/non-JSON error body; retain the status-based message.
      }
      throw ApiException(res.statusCode, message);
    }

    final contentType = res.headers['content-type']?.toLowerCase() ?? '';
    if (expectedContentType != null && !contentType.contains(expectedContentType.toLowerCase())) {
      throw ApiException(res.statusCode, 'Unexpected download type: ${contentType.isEmpty ? 'unknown' : contentType}.');
    }
    if (res.bodyBytes.isEmpty) throw ApiException(res.statusCode, 'The downloaded file is empty.');
    return res.bodyBytes;
  }

  Future<dynamic> _send(String method, String path, [Object? body]) async {
    final req = http.Request(method, _uri(path));
    req.headers.addAll(_headers);
    if (body != null) req.body = jsonEncode(body);
    late http.StreamedResponse streamed;
    try {
      streamed = await req.send().timeout(const Duration(seconds: 25));
    } catch (e) {
      throw ApiException(0, 'Cannot reach the server. Check the server URL and that the WMS backend is running.\n($e)');
    }
    final res = await http.Response.fromStream(streamed);
    dynamic decoded;
    if (res.body.isNotEmpty) {
      try {
        decoded = jsonDecode(res.body);
      } catch (_) {
        decoded = res.body;
      }
    }
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return decoded;
    }
    final msg = (decoded is Map && decoded['error'] != null)
        ? decoded['error'].toString()
        : 'Request failed (${res.statusCode}).';
    throw ApiException(res.statusCode, msg);
  }
}
