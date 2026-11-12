exports.createPinSubject = ({ actualOnToggleSeatPin, hostEffects }) => seat => {
  actualOnToggleSeatPin(seat);
  hostEffects.refreshInventory(seat);
};
