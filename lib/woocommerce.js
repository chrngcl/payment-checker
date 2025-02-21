// Library
const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('qs');

// Cookie storage
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

// Helper
const Helper = require('./helper.js');

// Function
class Woocommerce {
  static #jar = new CookieJar();
  static #client = wrapper(axios.create({ jar: Woocommerce.#jar }));

  static async #extract_link(main_url, content) {
    const $ = cheerio.load(content);
    const links = {};

    const direct_cart = $('a.add_to_cart_button.ajax_add_to_cart').attr('href');
    if (direct_cart && !direct_cart.toLowerCase().includes('javascript') && !direct_cart.startsWith('http://') && !direct_cart.startsWith('https://')) {
      links.direct_cart = new URL(direct_cart, main_url).toString();
    } else {
      links.direct_cart = direct_cart;
    }

    const product_item = $('a.woocommerce-LoopProduct-link.woocommerce-loop-product__link').attr('href');
    if (product_item && !product_item.startsWith('http://') && !product_item.startsWith('https://')) {
      links.product_item = new URL(product_item, main_url).toString();
    } else {
      links.product_item = product_item;
    }

    const product_category = $('li.product-category.product a').attr('href');
    if (product_category && !product_category.startsWith('http://') && !product_category.startsWith('https://')) {
      links.product_category = new URL(product_category, main_url).toString();
    } else {
      links.product_category = product_category;
    }

    return links;
    console.log(links);
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

  static async #product_sniffer(main_url, input_link, log = new Set()) {
    const checkout_url = new URL('/checkout', main_url).toString();
    let add_to_cart;
    let url_source;

    try {
      if (log.has(input_link)) {
        return false;
      }
      log.add(input_link);

      const response = await this.#client.get(input_link);

      if (!response.data.includes('/wp-content/')) {
        return { status: 'invalid' };
      }

      const link = await this.#extract_link(main_url, response.data);

      if (link.direct_cart) {
        url_source = link.direct_cart;
        add_to_cart = await this.#create_session(main_url, link.direct_cart, 'direct');
      } else if (link.product_item) {
        url_source = link.product_item;
        add_to_cart = await this.#create_session(main_url, link.product_item, 'form');
      } else if (link.product_category) {
        return await this.#product_sniffer(main_url, link.product_category, log);
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
      return { status: 'error', message: 'An error has occured.' };
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

  static async #item_sniffer(url) {
    let default_item = null;

    for (let page = 1; page <= 25; page++) {
      const store_api = new URL(`/wp-json/wc/store/products?page=${page}&per_page=100`, url).toString();

      try {
        const response = await this.#client.get(store_api, {
          headers: {
            'Accept': 'application/json'
          },
        });

        if (response.status === 200) {
          const items = response.data;
          if (items.length === 0) {
            break;
          }

          for (const item of items) {
            if (item.is_purchasable && item.is_in_stock) {
              const default_price = parseFloat(item.prices.price) / 100;

              // Check if direct cart exist
              let direct_cart = item.add_to_cart?.url;
              if (direct_cart?.startsWith('?')) {
                direct_cart = new URL(direct_cart, url).toString();
              }
              const result_link = direct_cart || item.permalink;

              if (default_price < 50) {
                return result_link;
              } else if (!default_item) {
                default_item = result_link;
              }
            }
          }
        }
      } catch (error) {
        console.error(error);
        return { status: 'error', message: 'An error has occured.' };
      } finally {
        await this.#jar.removeAllCookies();
      }
    }

    if (default_item) {
      return default_item;
    }

    // Throw null if none
    return null;
  }

  // Credits to @ninongnyory '1 curl method'
  static async rapid(url, item_config = false) {
    url = Helper.url_protocol(url);
    const main_url = Helper.url_base(url);
    const store_api = new URL('/wp-json/wc/store/cart', main_url).toString();

    try {
      const response = await this.#client.get(store_api, {
        headers: {
          'Accept': 'application/json'
        },
      });

      if (response.status === 200) {
        // Search for payment_methods
        const data = response.data;
        if (data.payment_methods && data.payment_methods.length > 0) {
          if (item_config) {
            const item_result = await this.#item_sniffer(main_url);
            return { item_url: item_result, payment_sources: data.payment_methods };
          } else {
            return { payment_sources: data.payment_methods };
          }
        } else {
          return { status: 'error', message: 'No payment methods found.' };
        }
      } else {
        return { status: 'error', message: 'Website is not responsive.' };
      }
    } catch (error) {
      console.error(error);
      return { status: 'error', message: 'An error has occured.' };
    } finally {
      await this.#jar.removeAllCookies();
    }
  }
  
  static async main(url) {
    let response;
    url = Helper.url_protocol(url);
    const main_url = Helper.url_base(url);

    const common_paths = ['/shop', '/store', '/product'];
    try {
      response = await this.#product_sniffer(main_url, url);
      console.log(response);

      if (response.status === 'forbidden') {
        return { status: 'error', message: 'Website is not responsive.' };
      } else if (response.status === 'invalid') {
        return { status: 'error', message: 'Invalid Woocommerce website.' }
      } else if (response.status === 'error') {
        for (let path of common_paths) {
          const common_url = new URL(path, main_url).toString();
          response = await this.#product_sniffer(main_url, common_url);

          if (response?.checkout?.payment) {
            break;
          }
        }
      }

      if (response?.checkout?.payment) {
        return {
          item_url: response.url,
          payment_sources: response.checkout.payment,
          captcha_status: response.checkout.captcha,
        };
      } else {
        return { status: 'error', message: 'Applied advance framework but response failed.' };
      }
    } catch (error) {
      console.error(error);
      return { status: 'error', message: 'An error has occured.' };
    } finally {
      await this.#jar.removeAllCookies();
    }
  }
}

module.exports = Woocommerce;
