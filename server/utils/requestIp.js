export function getRequestIp(request) {
  return request.ip || request.socket?.remoteAddress || '<unknown>'
}
