// Library
const axios = require('axios');
const { URL } = require('url');

// Function
class Helper {
  static url_base(url) {
    let url_api;
    let default_url;

    try {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        url_api = new URL(url);
        default_url = `${url_api.protocol}//${url_api.hostname}`;
      } else {
        url_api = new URL('http://' + url);
        default_url = `${url.hostname}`;
      }

      return default_url;
    } catch (error) {
      console.log(`Invalid URL (${url})`);
      return false;
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