const wol = require('wake_on_lan');

const MAC = 'D8:74:EF:1D:A0:49';

wol.wake(MAC, function(error) {
  if (error) {
    console.log('❌ Greška:', error);
  } else {
    console.log('🚀 Wake-on-LAN paket poslan');
  }
});