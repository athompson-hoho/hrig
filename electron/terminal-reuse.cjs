const owner = connection => connection && JSON.stringify([
  connection.id, connection.kind, connection.host, connection.port, connection.distro, connection.rigBinary,
]);
function seatTerminalReuse(item, options, seat) {
  return !!item && !!options.seatId && typeof options.session === 'string' && !!options.session &&
    owner(item.connection) === owner(options.connection) && item.seatId === options.seatId &&
    item.session === options.session && seat?.id === options.seatId && seat.session === options.session;
}
module.exports = { seatTerminalReuse };
