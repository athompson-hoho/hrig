exports.createPodSubject = ({ actualOnTogglePod, hostEffects }) => seat => {
  actualOnTogglePod(seat);
  hostEffects.refreshInventory(seat);
};
