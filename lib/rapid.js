// Library
const axios = require('axios');

// Cookie storage
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

// Function
class Rapid {
  static #jar = new CookieJar();
  static #client = wrapper(axios.create({ jar: Rapid.#jar }));

  // ===================== Magento ===================== //
  static async #magento_extract_base(url) {
    try {
      const { data: html } = await this.#client.get(url);

      const match = html.match(/"updateRequestConfig":{"url":"(.*?)V1/);
      if (match) {
        return match[1].replace(/\\\//g, '/');
      }

      return { status: 'error', message: 'API not found.' };
    } catch (error) {
      console.error(error);
      return { status: 'error', message: 'An error has occured.' };
    }
  }

  static async #magento_create_session(base_api) {
    try {
      const { data } = await this.#client.post(`${base_api}V1/guest-carts/`, {}, {
        headers: { 'Content-Type': 'application/json' }
      });

      if (data?.length === 32) return data;
      return { status: 'error', message: 'Guest checkout is disabled.' };
    } catch (error) {
      console.error(error);
      return { status: 'error', message: 'An error has occured.' };
    }
  }

  static async #magento_payment_methods(session, base_api) {
    try {
      const { data, status } = await this.#client.get(`${base_api}V1/guest-carts/${session}/payment-information`);
      if (status !== 200) {
        return { status: 'error', message: 'API cannot be reached.' };
      }

      if (!data.payment_methods?.length) {
        return { status: 'error', message: 'No payment methods available.' };
      }

      return data.payment_methods.map(method => method.code).join(', ');
    } catch (error) {
      console.error(error);
      return { status: 'error', message: 'An error has occured.' };
    }
  }

  static async magento(url) {
    try {
      const base = await this.#magento_extract_base(url);
      if (typeof base !== 'string') return base;

      const session = await this.#magento_create_session(base);
      if (typeof session !== 'string') return session;

      const payment_source = await this.#magento_payment_methods(session, base);
      return typeof payment_source === 'string'
        ? { payment_sources: payment_source }
        : payment_source;
    } catch (error) {
      console.error(error);
      return { status: 'error', message: 'An error has occured.' };
    } finally {
      await this.#jar.removeAllCookies();
    }
  }
  // ===================== Magento ===================== //

  // ======================= Woo ======================= //
  // @ninongnyory's credit
  static async woocommerce(url) {
    const store_api = new URL('/wp-json/wc/store/cart', url).toString();

    try {
      const { data, status } = await this.#client.get(store_api, {
        headers: { 'Accept': 'application/json' },
      });

      if (status !== 200) {
        return { status: 'error', message: 'Website is not responsive.' };
      }

      const payment_methods = data?.payment_methods;
      if (!payment_methods?.length) {
        return { status: 'error', message: 'No payment methods found.' };
      }

      return { payment_sources: payment_methods.join(', ') };
    } catch (error) {
      console.error(error);
      return { status: 'error', message: 'An error has occurred.' };
    } finally {
      await this.#jar.removeAllCookies();
    }
  }
  // ======================= Woo ======================= //
}

module.exports = Rapid;
