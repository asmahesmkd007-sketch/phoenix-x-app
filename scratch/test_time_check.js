// Test script for 8:30-9:00 slot
const testTimeCheck = (h, m) => {
  const hours = h;
  const minutes = m;
  const result = (hours === 8 && minutes >= 30);
  console.log(`Checking ${h}:${m.toString().padStart(2, '0')} -> ${result ? 'MATCH' : 'NO MATCH'}`);
};

console.log("--- Positive cases ---");
testTimeCheck(8, 30);
testTimeCheck(8, 45);
testTimeCheck(8, 59);

console.log("\n--- Negative cases ---");
testTimeCheck(8, 29);
testTimeCheck(9, 00);
testTimeCheck(7, 30);
testTimeCheck(20, 30);
