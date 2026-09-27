const normalizeWhatsAppNumber = (phoneNumber, countryCode = "91") => {
  if (!phoneNumber) return "";
  // Remove all non-numeric characters
  let cleaned = phoneNumber.replace(/\D/g, "");
  // Remove leading zeros
  cleaned = cleaned.replace(/^0+/, "");
  
  // If the number starts with the country code and has length 12 (e.g. 919876543210)
  if (cleaned.startsWith(countryCode) && cleaned.length === (countryCode.length + 10)) {
    return cleaned;
  }
  
  // If it's a standard 10-digit number, append country code
  if (cleaned.length === 10) {
    return `${countryCode}${cleaned}`;
  }
  
  return cleaned;
};

const generateWhatsAppUrl = (phoneNumber, jobTitle, companyName) => {
  const normalizedNumber = normalizeWhatsAppNumber(phoneNumber);
  if (!normalizedNumber) return null;
  const message = `Hello, I am interested in the ${jobTitle} position at ${companyName}. I would like to know more about this opportunity.`;
  const encodedMessage = encodeURIComponent(message);
  return `https://wa.me/${normalizedNumber}?text=${encodedMessage}`;
};

const isValidPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return false;
  const cleaned = phoneNumber.replace(/\D/g, "");
  // Checks length fits valid global/Indian phone profiles (10 to 13 digits)
  return cleaned.length >= 10 && cleaned.length <= 15;
};

module.exports = {
  normalizeWhatsAppNumber,
  generateWhatsAppUrl,
  isValidPhoneNumber,
};