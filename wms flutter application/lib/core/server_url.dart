/// Which server the app talks to, and the rules for changing it.
///
/// Deliberately a plain library with no Flutter, plugin or platform import, so
/// every rule below is unit-tested directly (test/server_url_test.dart) rather
/// than through a widget on a device.
///
/// Why the app is pinned to one server by default: a storekeeper's phone
/// posting a goods issue to the wrong store is a stock error nobody can see
/// afterwards. The setting exists because the Android UAT cannot otherwise be
/// run at all — the alternative was testing reversals and cycle counts against
/// production. So the rules here are about making the wrong server hard to
/// reach by accident and impossible to be on without noticing, not about
/// making it configurable for its own sake.
class ServerUrl {
  const ServerUrl._();

  /// The server every normal install talks to.
  static const defaultUrl = 'https://wms.kynox.io';

  /// Trims, drops trailing slashes, and lower-cases scheme and host so two
  /// spellings of one server compare equal — `HTTPS://WMS.Kynox.io/` and
  /// `https://wms.kynox.io` must not read as two different servers, or the
  /// "you are not on the production server" banner would fire on the
  /// production server.
  static String normalize(String input) {
    var value = input.trim();
    while (value.endsWith('/')) {
      value = value.substring(0, value.length - 1);
    }
    final uri = Uri.tryParse(value);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty) return value;
    final scheme = uri.scheme.toLowerCase();
    final buffer = StringBuffer('$scheme://${uri.host.toLowerCase()}');
    // Uri.port reports the scheme's default when none was typed, so comparing
    // against it keeps `https://host:443` and `https://host` identical.
    final defaultPort = scheme == 'https' ? 443 : 80;
    if (uri.port != 0 && uri.port != defaultPort) buffer.write(':${uri.port}');
    buffer.write(uri.path);
    return buffer.toString();
  }

  /// Null when [input] can be used, otherwise the reason it cannot — phrased
  /// for the person typing it, not for a log.
  static String? validationError(String input) {
    final value = input.trim();
    if (value.isEmpty) return 'Enter a server address.';
    final uri = Uri.tryParse(value);
    if (uri == null) return 'That is not a valid address.';
    if (!uri.hasScheme) return 'Enter the full address, starting with https://';
    final scheme = uri.scheme.toLowerCase();
    if (scheme != 'http' && scheme != 'https') {
      return 'The address must start with https:// or http://';
    }
    if (uri.host.isEmpty) return 'That address has no server name in it.';
    if (uri.hasQuery || uri.hasFragment) {
      return 'Enter the server address only, with nothing after ? or #';
    }
    // Credentials travel on the first request. Plain http is allowed only
    // where it cannot leave the building: a phone on the site's own wifi
    // talking to a laptop is the realistic UAT setup, and refusing it would
    // push testers back onto production, which is the thing this avoids.
    if (scheme == 'http' && !isLocalHost(uri.host)) {
      return 'Plain http:// is only allowed for a server on this network. '
          'Use https:// for anything reachable from the internet.';
    }
    return null;
  }

  /// Loopback, `.local`, or an RFC 1918 private range — a host that cannot be
  /// reached from outside the network the phone is on.
  static bool isLocalHost(String host) {
    final h = host.toLowerCase();
    if (h == 'localhost' || h == '127.0.0.1' || h == '::1') return true;
    if (h.endsWith('.local')) return true;
    final parts = h.split('.');
    if (parts.length != 4) return false;
    final octets = <int>[];
    for (final part in parts) {
      final n = int.tryParse(part);
      if (n == null || n < 0 || n > 255) return false;
      octets.add(n);
    }
    if (octets[0] == 10) return true;
    if (octets[0] == 192 && octets[1] == 168) return true;
    if (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    return false;
  }

  /// True when [url] is the production server this app ships pointed at.
  static bool isDefault(String url) => normalize(url) == defaultUrl;

  /// Just the host, for a banner or a one-line label.
  static String hostOf(String url) {
    final host = Uri.tryParse(url)?.host;
    return (host == null || host.isEmpty) ? url : host;
  }
}
