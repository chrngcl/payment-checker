// Library
const axios = require('axios');
const { URL } = require('url');

// Function
class Helper {
  static async url_base(url) {
    try {
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = "http://" + url;
      }

      const url_api = new URL(url);
      const default_url = `${url_api.protocol}//${url_api.hostname}`;

      const response = await axios.get(default_url, { timeout: 10000 });
      const html = response.data.toLowerCase();

      // Woocommerce
      if (html.includes("wp-content")) {
        return { type: 1, base: default_url };
      }

      // Magento
      if (html.includes("/static/") || html.includes("catalog/product")) {
        return { type: 2, base: default_url };
      }

      // Default
      return 0;
    } catch (error) {
      console.error(error);
      return 5;
    }
  }

  static url_protocol(url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return `http://${url}`;
    }
    
    return url;
  }

  static async url_status(url) {
    try {
      const response = await axios.head(url);
      return response.status === 200;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

}

module.exports = Helper;
