// Library
const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('qs');

// Cookie storage
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

// Function
class Woocommerce {
  static #jar = new CookieJar();
  static #client = wrapper(axios.create({ jar: Woocommerce.#jar }));

  static async #extract_link(main_url, content) {
    let default_item = null;
    let link_type = 'form';

    for (let page = 1; page <= 25; page++) {
      const store_api = new URL(`/wp-json/wc/store/products?page=${page}&per_page=100`, url).toString();

      try {
        const response = await this.#client.get(store_api, {
          headers: { 'Accept': 'application/json' },
        });

        if (response.status === 200) {
          const items = response.data;
          if (items.length === 0) {
            break;
          }

          for (const item of items) {
            if (item.is_purchasable && item.is_in_stock) {
              const default_price = parseFloat(item.prices.price) / 100;

              let direct_cart = item.add_to_cart?.url;
              if (direct_cart?.startsWith('?')) {
                direct_cart = new URL(direct_cart, url).toString();
                link_type = 'direct';
              }

              const result_link = direct_cart || item.permalink;

              if (default_price < 50) {
                return { link: result_link, type: link_type };
              } else if (!default_item) {
                default_item = result_link;
              }
            }
          }
        }
      } catch (error) {
        console.error(error);
        return null;
      }
    }

    if (default_item) {
      return { link: result_link, type: link_type };
    }

    return null;
  }

  static async #create_session(main_url, input_link, type) {
    let form_url;
    let response_cookie;
    const payload = new URLSearchParams();

    try {
      const response = await this.#client.get(input_link);

      if (type === 'direct') {
        response_cookie = await this.#jar.getCookies(main_url);
      } else if (type === 'form') {
        const $ = cheerio.load(response.data);

        form_url = $('form.cart').attr('action');
        const form_variation = $('form.cart').attr('data-product_variations');

        if (!form_url) {
          form_url = input_link;
        } else if (!form_url.startsWith('http://') && !form_url.startsWith('https://')) {
          form_url = new URL(form_url, main_url).toString();
        }

        $('form.cart :input').each((_, element) => {
          const name = $(element).attr('name');
          const value = $(element).val();
          if (name && value) {
            payload.append(name, value);
          }
        });

        $('form.cart button[type="submit"]').each((_, button) => {
          const name = $(button).attr('name');
          const value = $(button).attr('value');
          if (name && value) {
            payload.append(name, value);
          }
        });

        if (form_variation) {
          const raw_var_id = form_variation.match(/variation_id":(.*?),/);
          const raw_qty = form_variation.match(/min_qty":(.*?),/);

          const var_id = raw_var_id ? raw_var_id[1] : 0;
          const qty = raw_qty ? raw_qty[1] : 1;

          if (var_id) {
            payload.set('variation_id', var_id);
          }

          if (qty) {
            payload.set('quantity', qty);
          }
        }

        await this.#client.post(form_url, payload.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });

        response_cookie = await this.#jar.getCookies(main_url);
      }

      const response_success = response_cookie.some(cookie => cookie.key === 'woocommerce_items_in_cart' && cookie.value === '1');
      if (response_success) {
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  static async #product_sniffer(main_url) {
    const checkout_url = new URL('/checkout', main_url).toString();
    let add_to_cart;
    let url_source;

    try {
      const response = await this.#extract_link(main_url);

      if (response.type === 'direct') {
        url_source = response.link;
        add_to_cart = await this.#create_session(main_url, response.link, 'direct');
      } else if (response.type === 'form') {
        url_source = response.link;
        add_to_cart = await this.#create_session(main_url, response.link, 'form');
      } else {
        return { status: 'error', message: 'Failed to find a specific string.' };
      }

      if (add_to_cart) {
        const checkout_response = await this.#client.get(checkout_url);
        const payment_source = await this.#payment_sources(checkout_response.data);
        if (payment_source.payment) {
          return { url: url_source, checkout: payment_source  };
        } else {
          return { status: 'error', message: 'Failed to find payment sources.' };
        }
      } else {
        return { status: 'error', message: 'Failed to add an item.' };
      }
    } catch (error) {
      //console.error(error);
      //console.error(error.code);

      if (error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
        return { status: 'forbidden' };
      }
      return { status: 'error', message: 'This website is not valid for this method.' };
    }
  }

  static async #payment_sources(content) {
    const $ = cheerio.load(content);
    const psources = [];
    let captcha_bool = false;

    // Credits to @Metsowi (Sensui)
    const filter_words = [
      'captcha', 'recaptcha', 'recaptcha-v3-js', 'i13-woo-captcha-explicit',
      'wordfence-ls-recaptcha', 'g-recaptcha', 'agr-recaptcha', 'h-captcha',
      'i13-woo-captcha', 'google-recaptcha', 'wpcf7-recaptcha', 'gglcptch_recaptcha',
      'cf-turnstile',
    ];

    const main_string = $('label[for^="payment_method_"]').length > 0;
    if (main_string) {
      $('label[for^="payment_method_"]').each((index, element) => {
        const sources = $(element).attr('for').match(/payment_method_([^\s]+)/);
        if (sources) {
          psources.push(sources[1]);
        }
      });
    } else {
      $('input[class^="wc_payment_method payment_method_"]').each((index, element) => {
        const sources = $(element).attr('class').match(/payment_method_([^\s]+)/);
        if (sources) {
          psources.push(sources[1]);
        }
      });
    }

    const filter = new RegExp(filter_words.join('|'), 'i');
    captcha_bool = filter.test(content);

    return {
      payment: psources.length > 0 ? psources : false,
      captcha: captcha_bool
    };
  }
  
  static async main(url) {
    let response;

    try {
      response = await this.#product_sniffer(url);
      if (response.status === 'forbidden') {
        return { status: 'error', message: 'Website is not responsive.' };
      }

      if (response?.checkout?.payment) {
        return {
          item_url: response.url,
          payment_sources: response.checkout.payment,
          captcha_status: response.checkout.captcha,
        };
      } else {
        return { status: 'error', message: response.message };
      }
    } catch (error) {
      console.error(error);
      return { status: 'error', message: 'This website is not valid for this method.' };
    } finally {
      await this.#jar.removeAllCookies();
    }
  }
}

module.exports = Woocommerce;
